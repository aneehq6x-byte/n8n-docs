import unicodedata

from tenderpilot.verify import check_quote, normalize

PAGE = "يَجِبُ على المتنافس تقديم شهادة الأيزو 9001 سارية المفعول، وإلا يُستبعد العرض."


def test_normalize_folds_diacritics_variants_and_digits():
    assert normalize("إِلزامـــي ٩٠٠١") == normalize("الزامي 9001")
    assert normalize("المدة") == normalize("المده")


def test_exact_match_ignores_diacritics_and_punctuation():
    assert check_quote("شهادة الأيزو 9001 سارية المفعول", [PAGE], 1) == "exact"


def test_presentation_forms_are_folded():
    # Some PDF text layers emit Arabic presentation-form glyphs.
    shaped = "ﺷﻬﺎﺩﺓ"  # "شهادة" in presentation forms
    assert unicodedata.normalize("NFKC", shaped) != shaped
    assert check_quote("شهادة الأيزو", [PAGE.replace("شهادة", shaped)], 1) == "exact"


def test_reversed_word_order_matches_fuzzily():
    reversed_page = " ".join(reversed(PAGE.split()))
    assert check_quote("تقديم شهادة الأيزو 9001 سارية", [reversed_page], 1) == "fuzzy"


def test_wrong_page_number_falls_back_to_whole_document():
    assert check_quote("شهادة الأيزو", ["صفحة أخرى", PAGE], 1) == "exact"


def test_fabricated_quote_is_not_found():
    assert check_quote("يشترط تقديم ضمان بنكي بنسبة 5%", [PAGE], 1) == "not_found"
