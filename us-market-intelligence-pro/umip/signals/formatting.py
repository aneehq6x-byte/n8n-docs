"""Signal message templates (Telegram HTML). Values come only from the stored
signal snapshot — never from an LLM."""

from __future__ import annotations

from datetime import datetime
from html import escape

from umip.instruments import get_spec
from umip.models import Signal, SignalStatus
from umip.timeutil import format_dual

STATUS_AR = {
    "published": "بانتظار الدخول WAITING FOR ENTRY", "active": "نشطة ACTIVE",
    "target1_hit": "تحقق الهدف الأول ✅", "target2_hit": "تحقق الهدف الثاني ✅✅",
    "stopped": "تم ضرب الوقف ❌", "expired": "انتهت دون دخول EXPIRED",
    "cancelled": "ملغاة CANCELLED",
}


def _f(x: float | None) -> str:
    return "—" if x is None else f"{x:,.2f}"


def render_signal(sig: Signal, lang: str = "ar") -> dict:
    o = sig.original
    opt = o.get("option")
    spec = get_spec(sig.symbol)
    dir_label = ("CALL" if sig.direction == "long" else "PUT") if opt else \
        ("LONG" if sig.direction == "long" else "SHORT")
    lines = ["<b>US MARKET INTELLIGENCE PRO</b>", ""]
    lines.append("🚨 <b>NEW OPTIONS TRADE SETUP</b>" if opt else "🚨 <b>NEW TRADE SETUP</b>")
    if sig.is_mock_data:
        lines.append("🧪 <b>TEST DATA — NOT A REAL SIGNAL</b>")
    lines += ["", f"المرجع: <code>{sig.ref}</code>", f"الأصل: <b>{escape(sig.symbol)}</b>",
              f"الاتجاه: <b>{dir_label}</b>"]
    if opt:
        lines += [f"العقد: <code>{escape(opt['contract'])}</code>",
                  f"تاريخ الانتهاء: {opt['expiry']}", f"Strike: {_f(opt['strike'])}",
                  f"Bid/Ask وقت الإصدار: {_f(opt['bid'])} / {_f(opt['ask'])}",
                  f"سعر دخول تقديري (بعد التكاليف): {_f(opt['entry_est'])}",
                  f"أقصى خسارة للعقد: ${_f(opt['max_loss_per_contract'])}",
                  f"التسوية: {spec.options_settlement} / {spec.options_exercise}"]
    lines += [
        f"السعر المرجعي للأصل: {_f(o['reference_price'])}",
        f"نطاق الدخول (الأصل): {_f(o['entry_low'])} – {_f(o['entry_high'])}",
        f"الهدف الأول: {_f(o['target1'])}", f"الهدف الثاني: {_f(o['target2'])}",
        f"وقف الخسارة: {_f(o['stop'])}", f"المخاطرة/العائد: 1:{o['reward_risk']}",
        f"التقييم الكمي: {sig.score:.0f}/100", f"الإبطال: {escape(o['invalidation'])}", "",
        f"سبب الإشارة:\n{escape(o['reason'])}", "",
        f"وقت الإشارة: {format_dual(datetime.fromisoformat(o['detected_at']))}",
        f"صالحة حتى: {format_dual(sig.valid_until)}",
        f"مصدر البيانات: {escape(o['data_source'])} @ "
        f"{format_dual(datetime.fromisoformat(o['data_as_of']))}",
        f"الحالة: {STATUS_AR.get(sig.status.value, sig.status.value)}", "",
        "<i>محتوى تعليمي وليس نصيحة استثمارية شخصية. التداول ينطوي على مخاطر عالية.</i>",
    ]
    buttons = [[{"text": "تفاصيل التحليل", "callback_data": f"sig:detail:{sig.ref}"},
                {"text": "آخر تحديث", "callback_data": f"sig:status:{sig.ref}"}],
               [{"text": "عرض المخطط", "callback_data": f"sig:chart:{sig.ref}"},
                {"text": "متابعة حالة الصفقة", "callback_data": f"sig:follow:{sig.ref}"}]]
    return {"text": "\n".join(lines), "parse_mode": "HTML",
            "reply_markup": {"inline_keyboard": buttons}}


def render_update(sig: Signal, to: SignalStatus, note: str | None) -> dict:
    text = (f"<b>تحديث الإشارة</b> <code>{sig.ref}</code> — {escape(sig.symbol)}\n"
            f"الحالة: {STATUS_AR.get(to.value, to.value)}")
    if note:
        text += f"\n{escape(note)}"
    return {"text": text, "parse_mode": "HTML"}
