"""Build the editable Word report from the KT2 Markdown and PNG sources.

Requires pandoc, Graphviz (dot), python-docx and Pillow. Run from any directory:
    python3 docs/ux/build_docx.py
"""

from __future__ import annotations

import re
import subprocess
import tempfile
import textwrap
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "КТ2_Подпольный_журнал.docx"
REPO_URL = "https://github.com/yurapon11972020-hue/journal-site"
BRANCH = "codex/journal-kt2-ux-20261014"
SOURCE_URL = f"{REPO_URL}/blob/{BRANCH}/journal-site/docs/ux"

CHAPTERS = [
    ("requirements.md", "1. Актуализированное техническое задание"),
    ("sitemap.md", "2. Карта сайта и переходы"),
    ("flows.md", "3. Пользовательские сценарии"),
    ("wireframes.md", "4. Схематичные прототипы"),
    ("ui-kit.md", "5. Адаптация и UI Kit"),
    ("team-report.md", "6. Задачи команды и отчёт"),
]

DIAGRAM_CAPTIONS = [
    "Карта экранов и основных переходов",
    "S1. Выбор группы и открытие журнала",
    "S2. Поиск и просмотр табеля обучающегося",
    "S3. Оценки по предмету и темы занятий",
    "S4. Обновление данных из Excel",
    "S0. Условный вход по коду",
]


def github_link(match: re.Match[str]) -> str:
    label, target = match.groups()
    if target.startswith(("https://", "http://", "mailto:")):
        return match.group(0)
    path, separator, fragment = target.partition("#")
    if not path:
        return match.group(0)
    url = f"{SOURCE_URL}/{path}"
    if separator:
        url += f"#{fragment}"
    return f"[{label}]({url})"


def parse_node(token: str) -> tuple[str, str | None, bool]:
    match = re.fullmatch(r"([A-Za-z][A-Za-z0-9_]*)(?:\[(.*)\]|\{(.*)\})?", token.strip())
    if not match:
        raise ValueError(f"Unrecognized Mermaid node: {token!r}")
    node_id, box_label, decision_label = match.groups()
    label = decision_label if decision_label is not None else box_label
    if label is not None and label.startswith('"') and label.endswith('"'):
        label = label[1:-1]
    return node_id, label, decision_label is not None


def dot_quote(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def wrap_label(value: str, width: int = 27) -> str:
    return "\n".join(textwrap.wrap(value, width=width, break_long_words=False, break_on_hyphens=False))


def render_mermaid(source: str, destination: Path) -> None:
    nodes: dict[str, tuple[str, bool]] = {}
    edges: list[tuple[str, str, str | None]] = []
    for line in source.splitlines():
        line = line.strip()
        if not line or line.startswith("flowchart "):
            continue
        branch = re.fullmatch(r"(.*?)\s+--\s+(.+?)\s+-->\s+(.*)", line)
        if branch:
            left, edge_label, right = branch.groups()
        else:
            left, right = line.split(" --> ", 1)
            edge_label = None
        start, start_label, start_is_decision = parse_node(left)
        end, end_label, end_is_decision = parse_node(right)
        if start_label is not None:
            nodes[start] = (start_label, start_is_decision)
        else:
            nodes.setdefault(start, (start, False))
        if end_label is not None:
            nodes[end] = (end_label, end_is_decision)
        else:
            nodes.setdefault(end, (end, False))
        edges.append((start, end, edge_label))

    lines = [
        "digraph scenario {",
        'graph [rankdir=TB, bgcolor="white", pad="0.22", nodesep="0.28", ranksep="0.38", splines=polyline];',
        'node [fontname="DejaVu Sans", fontsize=12, shape=box, style="rounded,filled", color="#8da3b6", fillcolor="#f2f6fa", fontcolor="#17314a", penwidth=1.2, margin="0.16,0.10"];',
        'edge [fontname="DejaVu Sans", fontsize=10, color="#58758e", fontcolor="#455d72", arrowsize=0.7];',
    ]
    for node_id, (label, is_decision) in nodes.items():
        properties = [f"label={dot_quote(wrap_label(label))}"]
        if is_decision:
            properties += ['shape=diamond', 'style="filled"', 'fillcolor="#fff2d8"', 'color="#c9963d"']
        lines.append(f"{node_id} [{', '.join(properties)}];")
    for start, end, label in edges:
        properties = f" [label={dot_quote(label)}]" if label else ""
        lines.append(f"{start} -> {end}{properties};")
    lines.append("}")
    dot_file = destination.with_suffix(".dot")
    dot_file.write_text("\n".join(lines), encoding="utf-8")
    subprocess.run(["dot", "-Tpng", "-Gdpi=140", str(dot_file), "-o", str(destination)], check=True)


def chapter_markdown(filename: str, heading: str, diagram_dir: Path, counter: list[int]) -> str:
    source = (ROOT / filename).read_text(encoding="utf-8")
    source = re.sub(r"^# .*\n", "", source, count=1)
    chapter_number = heading.split(".", 1)[0]
    source = re.sub(
        r"^## (\d+)\. ",
        lambda match: f"## {chapter_number}.{match.group(1)}. ",
        source,
        flags=re.MULTILINE,
    )

    def replace_diagram(match: re.Match[str]) -> str:
        index = counter[0]
        counter[0] += 1
        destination = diagram_dir / f"diagram-{index + 1}.png"
        render_mermaid(match.group(1), destination)
        caption = DIAGRAM_CAPTIONS[index]
        return f"![{caption}]({destination.as_posix()}){{width=15cm}}"

    source = re.sub(r"```mermaid\n(.*?)\n```", replace_diagram, source, flags=re.DOTALL)
    source = re.sub(r"(?<!!)\[([^\]]+)\]\(([^)]+)\)", github_link, source)
    return f"# {heading}\n\n{source.strip()}\n"


def image_markdown(caption: str, filename: str, width: str) -> str:
    return f"![{caption}](mockups/{filename}){{width={width}}}\n"


def make_source(diagram_dir: Path) -> str:
    parts = [
        """---
title: "Контрольная точка № 2"
subtitle: "Проектирование интерфейса и UX проекта «Подпольный журнал»"
author:
  - "Илюха Говтва"
  - "Тимоха Усатов"
date: "14 октября 2026 года"
lang: ru-RU
---

**Дисциплина:** Графический дизайн и мультимедиа

**Статус:** проектные материалы для согласования командой

**Основание:** техническое задание КТ № 1 и задание КТ № 2

В документ включены требования, карта экранов, схемы сценариев, каркасы,
графические макеты, UI Kit и план работы команды. Интерактивное поведение
демонстрируется в отдельном HTML/CSS/JS-прототипе.

**Материалы в репозитории:** [папка UX](https://github.com/yurapon11972020-hue/journal-site/tree/codex/journal-kt2-ux-20261014/journal-site/docs/ux)

**Черновой PR:** [№ 31](https://github.com/yurapon11972020-hue/journal-site/pull/31)

"""
    ]
    counter = [0]
    for filename, heading in CHAPTERS:
        parts.append(chapter_markdown(filename, heading, diagram_dir, counter))
    if counter[0] != len(DIAGRAM_CAPTIONS):
        raise ValueError(f"Expected {len(DIAGRAM_CAPTIONS)} diagrams, found {counter[0]}")

    parts.append("# Приложение А. Графические макеты\n\n")
    screens = [
        ("E1. Список групп", "groups"),
        ("E2. Табели обучающихся", "reports"),
        ("E3. Оценки по предметам", "subjects"),
        ("E4. Темы занятий", "topics"),
    ]
    for label, stem in screens:
        parts.append(f"## {label}\n\n")
        parts.append(image_markdown(f"{label} — компьютер, 1440 px", f"{stem}-desktop.png", "16cm"))
        parts.append("\n")
        parts.append(image_markdown(f"{label} — телефон, 390 px", f"{stem}-mobile.png", "5.6cm"))
        parts.append("\n")
    extras = [
        ("E3 на планшете, 768 px", "subjects-tablet.png", "10cm"),
        ("E3 на узком телефоне, 360 px", "subjects-360.png", "5.6cm"),
        ("Раскрытая карточка обучающегося — компьютер", "student-card-desktop.png", "15cm"),
        ("Раскрытая карточка обучающегося — телефон", "student-card-mobile.png", "5.4cm"),
        ("Экран входа по коду — компьютер", "login-desktop.png", "16cm"),
        ("Ошибка кода — телефон", "login-error-mobile.png", "6cm"),
        ("Поиск без результатов — телефон", "search-empty-mobile.png", "5.6cm"),
        ("Лист компонентов UI Kit", "kit-desktop.png", "16cm"),
    ]
    parts.append("## Дополнительные варианты и состояния\n\n")
    for caption, filename, width in extras:
        parts.append(image_markdown(caption, filename, width))
        parts.append("\n")

    parts.append(
        f"""# Приложение Б. Кликабельный прототип и ссылки

**Источник:** [HTML-прототип]({SOURCE_URL}/prototype/index.html),
[стили]({SOURCE_URL}/prototype/styles.css), [логика]({SOURCE_URL}/prototype/prototype.js).
Графические данные в макетах вымышлены. Для запуска скачайте папку
`journal-site/docs/ux/prototype` из ветки `{BRANCH}` и выполните в ней:

```bash
python3 -m http.server 8000
```

Затем откройте `http://localhost:8000/` **на своём компьютере**. Это адрес
локального предпросмотра, а не опубликованная ссылка для преподавателя.
В прототипе можно переключать ширину, тему, каркасы и условный режим входа.
Демонстрационный код — `1234`.

**Завершённый путь 1:** E1 → выбор группы → E2 → поиск и раскрытие табеля →
возврат к группам. **Завершённый путь 2:** E1 → E2 → E3 → смена предмета →
E4 → возврат в журнал и к группам.

При ширине 360 px пути и кадры E0–E4 просмотрены в Chromium; таблица E3
прокручивается внутри блока. Проверка основного сайта и Firefox в этот результат
не включена. Доступ преподавателя к материалам и фактический вклад студентов
необходимо подтвердить перед сдачей.
"""
    )
    return "\n\n".join(parts)


def set_run_font(run, name: str, size: float, color: RGBColor | None = None) -> None:
    run.font.name = name
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color


def add_page_number(paragraph) -> None:
    paragraph.add_run("Страница ")
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = " PAGE "
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for element in (begin, instruction, separate, end):
        run._r.append(element)


def format_docx() -> None:
    doc = Document(OUTPUT)
    doc.core_properties.title = "КТ № 2 — проектирование интерфейса и UX электронного журнала"
    doc.core_properties.subject = "Материалы контрольной точки № 2"
    doc.core_properties.author = "OpenAI Codex"
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(1.7)
    section.bottom_margin = Cm(1.7)
    section.left_margin = Cm(1.75)
    section.right_margin = Cm(1.65)
    section.header_distance = Cm(0.75)
    section.footer_distance = Cm(0.75)

    styles = doc.styles
    def paragraph_style(name: str):
        return next(style for style in styles if style.name == name)

    normal = styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor(29, 43, 56)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.13
    for name, size, color in [
        ("Title", 25, RGBColor(25, 59, 99)),
        ("Subtitle", 16, RGBColor(49, 111, 165)),
        ("Heading 1", 17, RGBColor(25, 59, 99)),
        ("Heading 2", 13, RGBColor(25, 59, 99)),
        ("Heading 3", 11.5, RGBColor(49, 111, 165)),
    ]:
        style = paragraph_style(name)
        style.font.name = "Arial"
        style.font.size = Pt(size)
        style.font.color.rgb = color
        style.font.bold = True
        style.paragraph_format.keep_with_next = True
        style.paragraph_format.space_after = Pt(7)
    paragraph_style("Heading 1").paragraph_format.page_break_before = True
    paragraph_style("Heading 1").paragraph_format.space_before = Pt(0)
    paragraph_style("Heading 2").paragraph_format.space_before = Pt(13)
    for caption_name in ("Caption", "Image Caption", "Table Caption"):
        caption = paragraph_style(caption_name)
        caption.font.name = "Arial"
        caption.font.size = Pt(9)
        caption.font.color.rgb = RGBColor(87, 104, 118)
        caption.paragraph_format.space_after = Pt(10)

    header = section.header.paragraphs[0]
    header.text = "ПОДПОЛЬНЫЙ ЖУРНАЛ  ·  КОНТРОЛЬНАЯ ТОЧКА № 2"
    header.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    for run in header.runs:
        set_run_font(run, "Arial", 8, RGBColor(103, 117, 129))
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    add_page_number(footer)
    for run in footer.runs:
        set_run_font(run, "Arial", 8, RGBColor(103, 117, 129))

    for table in doc.tables:
        table.alignment = WD_TABLE_ALIGNMENT.CENTER
        table.autofit = True
        if table.rows:
            header_row = table.rows[0]
            marker = OxmlElement("w:tblHeader")
            marker.set(qn("w:val"), "true")
            header_row._tr.get_or_add_trPr().append(marker)
            for cell in header_row.cells:
                shade = OxmlElement("w:shd")
                shade.set(qn("w:fill"), "E8EFF5")
                cell._tc.get_or_add_tcPr().append(shade)
        for row_index, row in enumerate(table.rows):
            for cell in row.cells:
                cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
                for paragraph in cell.paragraphs:
                    paragraph.paragraph_format.space_after = Pt(2)
                    paragraph.paragraph_format.line_spacing = 1.05
                    for run in paragraph.runs:
                        set_run_font(run, "Arial", 8.2 if len(table.columns) >= 6 else 9)
                        if row_index == 0:
                            run.font.bold = True

    for paragraph in doc.paragraphs:
        if paragraph.style.name in ("Caption", "Image Caption", "Captioned Figure"):
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if paragraph.style.name == "Captioned Figure":
            paragraph.paragraph_format.keep_with_next = True
        if paragraph.style.name in ("Title", "Subtitle", "Author", "Date"):
            paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.save(OUTPUT)
    OUTPUT.chmod(0o644)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="journal-kt2-word-") as temp:
        temp_dir = Path(temp)
        markdown_path = temp_dir / "report.md"
        markdown_path.write_text(make_source(temp_dir), encoding="utf-8")
        subprocess.run(
            [
                "pandoc",
                str(markdown_path),
                "--from=markdown+link_attributes",
                "--to=docx",
                "--standalone",
                "--toc",
                "--toc-depth=2",
                f"--resource-path={ROOT}",
                "--output",
                str(OUTPUT),
            ],
            check=True,
        )
    format_docx()
    print(OUTPUT)


if __name__ == "__main__":
    main()
