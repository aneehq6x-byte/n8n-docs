import type { ApprovalGate, ApprovalGrant } from "../../approval/approval-gate.ts";
import { PlatformError } from "../../core/errors.ts";
import type { Clock } from "../../core/util.ts";
import { newId } from "../../core/util.ts";
import type {
  Connectors,
  EmailConnector,
  ErpConnector,
  Invoice,
  Payment,
  PaymentConnector,
  PurchaseOrder,
  SanctionsConnector,
  Supplier,
} from "../types.ts";
import { defaultFixtures, type Fixtures } from "./fixtures.ts";

/**
 * تنفيذات وهمية للـ connectors، تحتفظ بالحالة في الذاكرة.
 * - كل كتابة تُسجَّل في writes، فتستطيع evals أن تتحقق من عدم حدوث أي أثر غير مصرح به.
 * - failNext() يحقن عطلًا في الاستدعاء التالي لاختبار مسار التصعيد عند فشل نظام خارجي.
 * - الإجراءات التي لا رجعة فيها تستهلك ApprovalGrant عبر gate.redeem قبل تنفيذ الأثر.
 */

export interface WriteRecord {
  connector: string;
  method: string;
  args: unknown;
}

class FaultInjector {
  private pending = new Set<string>();
  failNext(method: string): void {
    this.pending.add(method);
  }
  check(method: string): void {
    if (this.pending.delete(method)) throw new PlatformError("CONNECTOR_ERROR", `Injected failure in ${method}`);
  }
}

export class MockErp implements ErpConnector {
  constructor(
    private readonly data: Fixtures,
    private readonly gate: ApprovalGate,
    private readonly clock: Clock,
    private readonly writes: WriteRecord[],
    readonly faults: FaultInjector,
  ) {}

  getSupplier(id: string) {
    this.faults.check("erp.getSupplier");
    return structuredClone(this.data.suppliers.find((s) => s.id === id) ?? null);
  }
  findSuppliers(f: { category?: string; name?: string }) {
    return structuredClone(
      this.data.suppliers.filter(
        (s) => (!f.category || s.categories.includes(f.category)) && (!f.name || s.name.toLowerCase().includes(f.name.toLowerCase())),
      ),
    );
  }
  getBudget(costCenter: string) {
    this.faults.check("erp.getBudget");
    return structuredClone(this.data.budgets.find((b) => b.costCenter === costCenter) ?? null);
  }
  getCatalogItem(sku: string) {
    return structuredClone(this.data.catalog.find((c) => c.sku === sku) ?? null);
  }
  searchCatalog(f: { category?: string; query?: string }) {
    const q = f.query?.toLowerCase();
    return structuredClone(
      this.data.catalog.filter((c) => (!f.category || c.category === f.category) && (!q || c.description.toLowerCase().includes(q) || c.sku.toLowerCase().includes(q))),
    );
  }
  listPurchaseOrders(f: { requesterId?: string; costCenter?: string; supplierId?: string; sinceIso?: string }) {
    return structuredClone(
      this.data.purchaseOrders.filter(
        (p) =>
          (!f.requesterId || p.requesterId === f.requesterId) &&
          (!f.costCenter || p.costCenter === f.costCenter) &&
          (!f.supplierId || p.supplierId === f.supplierId) &&
          (!f.sinceIso || p.createdAt >= f.sinceIso),
      ),
    );
  }
  getPurchaseOrder(id: string) {
    return structuredClone(this.data.purchaseOrders.find((p) => p.id === id) ?? null);
  }

  createPurchaseOrder(input: Omit<PurchaseOrder, "id" | "status" | "createdAt" | "total">, grant: ApprovalGrant): PurchaseOrder {
    const total = round2(input.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const budget = this.data.budgets.find((b) => b.costCenter === input.costCenter);
    if (!budget) throw new PlatformError("CONNECTOR_ERROR", `Unknown cost center ${input.costCenter}`);
    this.gate.redeem(grant, "commit_spend", { amount: total, currency: input.currency });
    this.faults.check("erp.createPurchaseOrder");
    const po: PurchaseOrder = {
      ...structuredClone(input),
      id: `PO-${1000 + this.data.purchaseOrders.length + 1}`,
      total,
      status: "open",
      createdAt: this.clock.now().toISOString(),
    };
    this.data.purchaseOrders.push(po);
    if (budget.currency === po.currency) budget.committed = round2(budget.committed + total);
    this.writes.push({ connector: "erp", method: "createPurchaseOrder", args: { poId: po.id, total, currency: po.currency } });
    return structuredClone(po);
  }

  getGoodsReceipts(poId: string) {
    return structuredClone(this.data.goodsReceipts.filter((g) => g.poId === poId));
  }
  getInvoice(id: string) {
    return structuredClone(this.data.invoices.find((i) => i.id === id) ?? null);
  }
  findInvoices(f: { supplierId?: string; invoiceNumber?: string; status?: Invoice["status"] }) {
    return structuredClone(
      this.data.invoices.filter(
        (i) =>
          (!f.supplierId || i.supplierId === f.supplierId) &&
          (!f.invoiceNumber || normalizeRef(i.invoiceNumber) === normalizeRef(f.invoiceNumber)) &&
          (!f.status || i.status === f.status),
      ),
    );
  }
  setInvoiceStatus(id: string, status: Invoice["status"], note: string): Invoice {
    this.faults.check("erp.setInvoiceStatus");
    const inv = this.data.invoices.find((i) => i.id === id);
    if (!inv) throw new PlatformError("NOT_FOUND", `Invoice ${id} not found`);
    if (inv.status === "paid") throw new PlatformError("CONNECTOR_ERROR", "Paid invoices are immutable");
    inv.status = status;
    this.writes.push({ connector: "erp", method: "setInvoiceStatus", args: { id, status, note } });
    return structuredClone(inv);
  }
  updateSupplierBank(supplierId: string, bank: Supplier["bankAccount"], grant: ApprovalGrant): Supplier {
    this.gate.redeem(grant, "master_data_change");
    const s = this.data.suppliers.find((x) => x.id === supplierId);
    if (!s) throw new PlatformError("NOT_FOUND", `Supplier ${supplierId} not found`);
    s.bankAccount = structuredClone(bank);
    this.writes.push({ connector: "erp", method: "updateSupplierBank", args: { supplierId } });
    return structuredClone(s);
  }

  /** للاختبارات فقط: إضافة بيانات إلى الحالة. */
  seed(mutator: (data: Fixtures) => void): void {
    mutator(this.data);
  }
}

export class MockPayments implements PaymentConnector {
  private readonly payments: Payment[] = [];
  constructor(
    private readonly data: Fixtures,
    private readonly gate: ApprovalGate,
    private readonly clock: Clock,
    private readonly writes: WriteRecord[],
    readonly faults: FaultInjector,
  ) {}

  execute(instr: { invoiceIds: string[]; supplierId: string; iban: string; amount: number; currency: string }, grant: ApprovalGrant): Payment {
    // ضمانة إضافية مستقلة عن الوكيل: الدفع فقط لمورد معتمد وعلى الحساب البنكي المسجل في سجله الرئيسي.
    // التحقق يسبق استهلاك التفويض، فلا يُستهلك تفويض على دفعة مرفوضة.
    const supplier = this.data.suppliers.find((s) => s.id === instr.supplierId);
    if (!supplier || supplier.status !== "approved") throw new PlatformError("CONNECTOR_ERROR", "Payee is not an approved supplier");
    if (supplier.bankAccount.iban !== instr.iban) throw new PlatformError("CONNECTOR_ERROR", "IBAN does not match supplier master data");
    const approval = this.gate.redeem(grant, "payment", { amount: instr.amount, currency: instr.currency });
    this.faults.check("payments.execute");
    const p: Payment = { id: newId("pay"), ...structuredClone(instr), executedAt: this.clock.now().toISOString(), approvalId: approval.id };
    this.payments.push(p);
    for (const id of instr.invoiceIds) {
      const inv = this.data.invoices.find((i) => i.id === id);
      if (inv) inv.status = "paid";
    }
    this.writes.push({ connector: "payments", method: "execute", args: { id: p.id, amount: p.amount, currency: p.currency } });
    return structuredClone(p);
  }
  listPayments(f: { supplierId?: string } = {}) {
    return structuredClone(this.payments.filter((p) => !f.supplierId || p.supplierId === f.supplierId));
  }
}

export class MockEmail implements EmailConnector {
  private readonly sent: Array<{ id: string; from: string; to: string[]; subject: string; body: string }> = [];
  constructor(
    private readonly data: Fixtures,
    private readonly gate: ApprovalGate,
    private readonly writes: WriteRecord[],
  ) {}
  inbox(mailbox: string) {
    return structuredClone(this.data.inbox[mailbox] ?? []);
  }
  send(msg: { from: string; to: string[]; subject: string; body: string }, grant: ApprovalGrant) {
    this.gate.redeem(grant, "external_send");
    const id = newId("mail");
    this.sent.push({ id, ...structuredClone(msg) });
    this.writes.push({ connector: "email", method: "send", args: { id, to: msg.to } });
    return { id };
  }
  outbox() {
    return structuredClone(this.sent);
  }
}

export class MockSanctions implements SanctionsConnector {
  constructor(private readonly data: Fixtures) {}
  entries() {
    return structuredClone(this.data.sanctions);
  }
  listVersion() {
    return "FICTIONAL-2029-03-01";
  }
}

export interface MockConnectors extends Connectors {
  erp: MockErp;
  payments: MockPayments;
  email: MockEmail;
  sanctions: MockSanctions;
  writes: WriteRecord[];
  faults: FaultInjector;
}

export function createMockConnectors(gate: ApprovalGate, clock: Clock, fixtures: Fixtures = defaultFixtures()): MockConnectors {
  const writes: WriteRecord[] = [];
  const faults = new FaultInjector();
  return {
    erp: new MockErp(fixtures, gate, clock, writes, faults),
    payments: new MockPayments(fixtures, gate, clock, writes, faults),
    email: new MockEmail(fixtures, gate, writes),
    sanctions: new MockSanctions(fixtures),
    writes,
    faults,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** توحيد أرقام المراجع لكشف التكرار: GOS-2029-0142 وgos 2029/0142 متطابقان. */
export function normalizeRef(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
}
