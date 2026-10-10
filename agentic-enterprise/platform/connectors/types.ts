import type { ApprovalGrant } from "../approval/approval-gate.ts";
import type { Money } from "../core/types.ts";

/**
 * واجهات موحدة للأنظمة الخارجية. الوكلاء والأدوات يعتمدون على هذه الواجهات فقط،
 * فاستبدال الـ mock بتكامل حقيقي (SAP أو Microsoft Graph أو بوابة البنك) لا يغيّر كود الوكلاء.
 *
 * قاعدة إلزامية: كل دالة ذات أثر لا رجعة فيه تأخذ ApprovalGrant، وتستهلكه عبر ApprovalGate.redeem
 * قبل تنفيذ الأثر. بدون تفويض صالح يرمي الـ connector خطأ، حتى لو استُدعي من خارج ToolExecutor.
 */

export interface Supplier {
  id: string;
  name: string;
  nameAr?: string;
  country: string;
  status: "approved" | "pending_onboarding" | "blocked";
  categories: string[];
  bankAccount: { iban: string; bankName: string; verifiedAt: string };
  paymentTermsDays: number;
  riskRating: "low" | "medium" | "high";
}

export interface Budget {
  costCenter: string;
  owner: string;
  fiscalYear: number;
  currency: string;
  total: number;
  committed: number;
  spent: number;
}

export interface CatalogItem {
  sku: string;
  description: string;
  category: string;
  unitPrice: number;
  currency: string;
  supplierId: string;
  contracted: boolean;
}

export interface PurchaseOrderLine {
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  costCenter: string;
  requesterId: string;
  currency: string;
  lines: PurchaseOrderLine[];
  total: number;
  status: "open" | "partially_received" | "received" | "closed" | "cancelled";
  createdAt: string;
  sourceTaskId: string;
}

export interface GoodsReceipt {
  id: string;
  poId: string;
  lines: Array<{ sku: string; quantityReceived: number }>;
  receivedAt: string;
}

export interface Invoice {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  poId: string | null;
  currency: string;
  lines: Array<{ sku: string; quantity: number; unitPrice: number }>;
  subtotal: number;
  tax: number;
  total: number;
  /** الحساب البنكي المذكور في الفاتورة. قد يختلف عن السجل الرئيسي، وهذه علامة احتيال. */
  remitToIban: string | null;
  issueDate: string;
  dueDate: string;
  status: "received" | "matched" | "on_hold" | "approved_for_payment" | "paid" | "rejected";
}

export interface Payment {
  id: string;
  invoiceIds: string[];
  supplierId: string;
  iban: string;
  amount: number;
  currency: string;
  executedAt: string;
  approvalId: string;
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  receivedAt: string;
}

export interface SanctionsEntry {
  id: string;
  list: "OFAC_SDN" | "EU_CONSOLIDATED" | "UN_SC";
  name: string;
  aliases: string[];
  country: string | null;
  type: "individual" | "entity";
}

export interface ErpConnector {
  getSupplier(id: string): Supplier | null;
  findSuppliers(filter: { category?: string; name?: string }): Supplier[];
  getBudget(costCenter: string): Budget | null;
  getCatalogItem(sku: string): CatalogItem | null;
  searchCatalog(filter: { category?: string; query?: string }): CatalogItem[];
  listPurchaseOrders(filter: { requesterId?: string; costCenter?: string; supplierId?: string; sinceIso?: string }): PurchaseOrder[];
  getPurchaseOrder(id: string): PurchaseOrder | null;
  /** إجراء commit_spend: يلزم الشركة ماليًا أمام المورد. */
  createPurchaseOrder(po: Omit<PurchaseOrder, "id" | "status" | "createdAt" | "total">, grant: ApprovalGrant): PurchaseOrder;
  getGoodsReceipts(poId: string): GoodsReceipt[];
  getInvoice(id: string): Invoice | null;
  findInvoices(filter: { supplierId?: string; invoiceNumber?: string; status?: Invoice["status"] }): Invoice[];
  /** كتابة داخلية قابلة للتراجع: تغيير حالة الفاتورة فقط. */
  setInvoiceStatus(id: string, status: Invoice["status"], note: string): Invoice;
  /** إجراء master_data_change: تغيير الحساب البنكي هو أكثر نواقل الاحتيال شيوعًا. */
  updateSupplierBank(supplierId: string, bank: Supplier["bankAccount"], grant: ApprovalGrant): Supplier;
}

export interface PaymentConnector {
  /** إجراء payment: لا رجعة فيه. */
  execute(instruction: { invoiceIds: string[]; supplierId: string; iban: string } & Money, grant: ApprovalGrant): Payment;
  listPayments(filter?: { supplierId?: string }): Payment[];
}

export interface EmailConnector {
  inbox(mailbox: string): EmailMessage[];
  /** إجراء external_send. */
  send(msg: { from: string; to: string[]; subject: string; body: string }, grant: ApprovalGrant): { id: string };
  outbox(): Array<{ id: string; from: string; to: string[]; subject: string; body: string }>;
}

export interface SanctionsConnector {
  entries(): SanctionsEntry[];
  listVersion(): string;
}

export interface Connectors {
  erp: ErpConnector;
  payments: PaymentConnector;
  email: EmailConnector;
  sanctions: SanctionsConnector;
}
