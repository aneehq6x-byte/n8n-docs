"""Arabic (default) and English UI strings."""

from __future__ import annotations

MENU: list[tuple[str, str, str]] = [
    # callback, ar, en
    ("market_now", "📊 تحليل السوق الآن", "📊 Market now"),
    ("opportunities", "🎯 فرص التداول المتاحة", "🎯 Open opportunities"),
    ("spx", "📈 إشارات SPX / SPY", "📈 SPX / SPY signals"),
    ("ndx", "💻 إشارات NASDAQ / QQQ", "💻 NASDAQ / QQQ signals"),
    ("stocks", "🏢 فرص الأسهم", "🏢 Stock ideas"),
    ("options", "📑 عقود الخيارات", "📑 Options"),
    ("news", "📰 الأخبار الاقتصادية", "📰 Economic news"),
    ("alerts", "🔔 إعدادات التنبيهات", "🔔 Alert settings"),
    ("results", "📉 نتائج الصفقات", "📉 Trade results"),
    ("subscribe", "⭐ الاشتراك في الخدمة", "⭐ Subscribe"),
    ("renew", "🔄 تجديد الاشتراك", "🔄 Renew"),
    ("my_sub", "📌 حالة اشتراكي", "📌 My subscription"),
    ("account", "👤 حسابي", "👤 My account"),
    ("assistant", "🤖 المساعد الذكي", "🤖 AI assistant"),
    ("support", "🎧 الدعم الفني", "🎧 Support"),
    ("terms", "ℹ️ شروط الاستخدام والمخاطر", "ℹ️ Terms & risk"),
]

PREMIUM_SECTIONS = {"opportunities", "spx", "ndx", "stocks", "options", "assistant"}

T = {
    "welcome": {
        "ar": "مرحبًا بك في US Market Intelligence Pro.\nتحليلات وأفكار تداول للسوق الأمريكي — "
              "لأغراض تعليمية ومعلوماتية. اختر من القائمة:",
        "en": "Welcome to US Market Intelligence Pro.\nUS market analysis and trade ideas — "
              "educational/informational. Choose an option:",
    },
    "terms_required": {
        "ar": "قبل المتابعة يجب الموافقة على شروط الاستخدام وإفصاح المخاطر.",
        "en": "Please accept the terms of use and risk disclosure to continue.",
    },
    "accept": {"ar": "✅ أوافق على الشروط", "en": "✅ I accept"},
    "terms": {
        "ar": "⚠️ إفصاح المخاطر\n• تداول الأسهم والخيارات ينطوي على مخاطر عالية وقد تخسر كامل المبلغ.\n"
              "• عقود 0DTE شديدة الخطورة.\n• النتائج السابقة والاختبارات التاريخية لا تضمن نتائج مستقبلية.\n"
              "• المحتوى ليس نصيحة استثمارية شخصية ولا يأخذ وضعك المالي في الاعتبار.\n"
              "• لا ننفذ صفقات نيابة عنك.",
        "en": "⚠️ Risk disclosure\n• Trading stocks and options is high risk; you can lose all capital.\n"
              "• 0DTE options are extremely risky.\n• Past and backtested results do not guarantee "
              "future results.\n• Content is not personalised investment advice.\n"
              "• We never execute trades on your behalf.",
    },
    "need_sub": {
        "ar": "🔒 هذا القسم متاح للمشتركين فقط. اضغط ⭐ الاشتراك في الخدمة.",
        "en": "🔒 Subscribers only. Tap ⭐ Subscribe.",
    },
    "choose_plan": {"ar": "اختر الخطة (الدفع بنجوم تيليجرام ⭐):",
                    "en": "Choose a plan (paid with Telegram Stars ⭐):"},
    "paid_ok": {
        "ar": "✅ تم تأكيد الدفع وتفعيل اشتراكك حتى {end}.\nاضغط الزر للانضمام إلى القناة الخاصة.",
        "en": "✅ Payment confirmed. Access active until {end}.\nTap to join the private channel.",
    },
    "join_btn": {"ar": "🔐 الانضمام للقناة الخاصة", "en": "🔐 Join private channel"},
    "sub_active": {"ar": "📌 اشتراكك فعّال حتى: {end}", "en": "📌 Active until: {end}"},
    "sub_none": {"ar": "لا يوجد اشتراك فعّال.", "en": "No active subscription."},
    "no_opps": {
        "ar": "لا توجد فرصة تستوفي معايير التداول حاليًا.",
        "en": "No opportunity currently meets the trading criteria.",
    },
    "data_down": {
        "ar": "⚠️ بيانات السوق غير متاحة أو متقادمة حاليًا، لذلك لا نعرض تحليلات لحظية.",
        "en": "⚠️ Market data is unavailable or stale; live analysis is paused.",
    },
    "renew_reminder": {
        "ar": "⏰ ينتهي اشتراكك خلال {days} يوم ({end}). جدّد الآن للحفاظ على الوصول.",
        "en": "⏰ Your access ends in {days} day(s) ({end}). Renew to keep access.",
    },
    "expired": {"ar": "انتهى اشتراكك وتم إيقاف الوصول للقناة الخاصة. يمكنك التجديد في أي وقت.",
                "en": "Your subscription ended and private access was removed. Renew anytime."},
    "trial_btn": {"ar": "🎁 تجربة مجانية", "en": "🎁 Free trial"},
    "trial_used": {"ar": "تم استخدام الفترة التجريبية مسبقًا.", "en": "Trial already used."},
    "support": {"ar": "🎧 للدعم الفني اكتب رسالتك هنا وسيتم الرد عليك.",
                "en": "🎧 Write your message and support will reply."},
    "paysupport": {
        "ar": "💳 دعم المدفوعات: أرسل رقم العملية ووصف المشكلة هنا وسيراجعها الفريق. "
              "الاسترداد يتم عبر نجوم تيليجرام وفق شروط الاستخدام.",
        "en": "💳 Payment support: send the transaction ID and a description here and the team "
              "will review it. Refunds are made in Telegram Stars per the terms of use.",
    },
    "coming": {"ar": "قريبًا.", "en": "Coming soon."},
}


def t(key: str, lang: str = "ar", **kw) -> str:
    s = T[key].get(lang) or T[key]["ar"]
    return s.format(**kw) if kw else s
