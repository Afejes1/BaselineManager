from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import BaseDocTemplate, Flowable, Frame, KeepTogether, PageBreak, Paragraph, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "A2O-Technical-Baseline-Manager-User-Guide.pdf"

NAVY = colors.HexColor("#102B46")
BLUE = colors.HexColor("#245B83")
TEAL = colors.HexColor("#197C82")
MINT = colors.HexColor("#DDEFEA")
SKY = colors.HexColor("#E8F1F7")
AMBER = colors.HexColor("#E5A33D")
SAND = colors.HexColor("#FFF5DF")
RED = colors.HexColor("#9F3131")
INK = colors.HexColor("#1F2D3D")
MUTED = colors.HexColor("#5B6873")
LINE = colors.HexColor("#C8D3DA")
WHITE = colors.white


def rounded_box(canvas, x, y, width, height, fill, stroke=LINE, radius=8):
    canvas.setFillColor(fill)
    canvas.setStrokeColor(stroke)
    canvas.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def arrow(canvas, x1, y1, x2, y2, color=BLUE):
    canvas.setStrokeColor(color)
    canvas.setFillColor(color)
    canvas.setLineWidth(1.6)
    canvas.line(x1, y1, x2, y2)
    dx, dy = x2 - x1, y2 - y1
    length = max((dx * dx + dy * dy) ** 0.5, 1)
    ux, uy = dx / length, dy / length
    left_x, left_y = x2 - 7 * ux - 3 * uy, y2 - 7 * uy + 3 * ux
    right_x, right_y = x2 - 7 * ux + 3 * uy, y2 - 7 * uy - 3 * ux
    path = canvas.beginPath()
    path.moveTo(x2, y2)
    path.lineTo(left_x, left_y)
    path.lineTo(right_x, right_y)
    path.close()
    canvas.drawPath(path, fill=1, stroke=0)


class Diagram(Flowable):
    def __init__(self, height):
        Flowable.__init__(self)
        self.width = 6.8 * inch
        self.height = height


class DataChainDiagram(Diagram):
    def __init__(self):
        super().__init__(3.1 * inch)

    def draw(self):
        c = self.canv
        w, h = self.width, self.height
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(0, h - 10, "DATA AND DECISION CHAIN")
        rows = [
            ("SELECTED LOCAL FILES", "A2O workbook, MCP/DSOR export, LM JSON or delivery files", SKY),
            ("RETAINED SOURCE OBSERVATIONS", "Immutable receipt, raw/normalized values, review, and field deltas", MINT),
            ("GOVERNMENT ANALYTICAL BASELINE", "Change effects, objectives, dependencies, evidence, and decisions", SAND),
            ("REPRODUCIBLE OUTPUTS", "Initiative one-pager, saved snapshot, leadership report, and audit history", colors.HexColor("#EAF0F4")),
        ]
        box_h, gap, x, box_w = 37, 12, 12, w - 24
        y = h - 53
        for index, (heading, detail, fill) in enumerate(rows):
            rounded_box(c, x, y, box_w, box_h, fill)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 8)
            c.drawString(x + 11, y + 22, heading)
            c.setFillColor(INK)
            c.setFont("Helvetica", 7.4)
            c.drawString(x + 11, y + 10, detail)
            if index < len(rows) - 1:
                arrow(c, w / 2, y - 2, w / 2, y - gap + 2)
            y -= box_h + gap
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Oblique", 7.4)
        c.drawString(12, 3, "The application records what was supplied, what was assessed, and what was decided without treating them as the same thing.")


class RelationshipDiagram(Diagram):
    def __init__(self):
        super().__init__(3.15 * inch)

    def box(self, c, x, y, width, height, label, detail, fill):
        rounded_box(c, x, y, width, height, fill)
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString(x + width / 2, y + height - 15, label)
        c.setFillColor(INK)
        c.setFont("Helvetica", 7)
        c.drawCentredString(x + width / 2, y + 12, detail)

    def draw(self):
        c, w, h = self.canv, self.width, self.height
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(0, h - 10, "ONE DECISION VERTICAL SLICE")
        box_w, left, gap, top = 108, 0, 18, 136
        columns = [left + i * (box_w + gap) for i in range(4)]
        self.box(c, columns[0], top, box_w, 38, "INITIATIVE", "Government outcome", SAND)
        self.box(c, columns[1], top, box_w, 38, "CHANGE REQUEST", "External work/funding reference", SKY)
        self.box(c, columns[2], top, box_w, 38, "LM OBJECTIVE", "Incumbent delivery commitment", MINT)
        self.box(c, columns[3], top, box_w, 38, "TECHNICAL EFFECT", "Action on selected object", colors.HexColor("#EAF0F4"))
        self.box(c, columns[3], 53, box_w, 38, "AFFECTED OBJECT", "Platform, Product, node, etc.", colors.HexColor("#F1F4F6"))
        self.box(c, columns[1], 53, box_w, 38, "EVIDENCE RECORD", "Call, risk, question, decision", SAND)
        arrow(c, columns[0] + box_w, 155, columns[1], 155)
        arrow(c, columns[1] + box_w, 155, columns[2], 155)
        arrow(c, columns[2] + box_w, 155, columns[3], 155)
        arrow(c, columns[3] + box_w / 2, 136, columns[3] + box_w / 2, 91)
        arrow(c, columns[1] + box_w / 2, 136, columns[1] + box_w / 2, 91, TEAL)
        c.setFillColor(MUTED)
        c.setFont("Helvetica", 6.5)
        c.drawCentredString(columns[0] + box_w + gap / 2, 164, "groups")
        c.drawCentredString(columns[1] + box_w + gap / 2, 164, "owns")
        c.drawCentredString(columns[2] + box_w + gap / 2, 164, "has")
        c.drawCentredString(columns[3] + box_w / 2 + 21, 115, "selects")
        c.drawCentredString(columns[1] + box_w / 2 + 20, 115, "supports")
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Oblique", 7.4)
        c.drawString(10, 17, "An Objective may be attributed to the Change Request effect it implements. A dependency is not an ownership link.")


class InformationStatesDiagram(Diagram):
    def __init__(self):
        super().__init__(2.38 * inch)

    def draw(self):
        c, w, h = self.canv, self.width, self.height
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(0, h - 10, "HOW TO READ INFORMATION STATUS")
        columns = [
            ("SOURCE CLAIM", "What was supplied.\nNot a Government conclusion.", SKY),
            ("GOVERNMENT ASSESSMENT", "Analysis or judgment.\nNot a decision.", MINT),
            ("GOVERNMENT DECISION", "Authority + date + rationale.", SAND),
            ("VERIFICATION / ACCEPTANCE", "Evidence + criterion or signoff.\nA seal alone is not acceptance.", colors.HexColor("#EAF0F4")),
        ]
        gap, box_w, box_h = 8, (w - 24) / 4, 103
        y = 37
        for i, (title, detail, fill) in enumerate(columns):
            x = i * (box_w + gap)
            rounded_box(c, x, y, box_w, box_h, fill)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 7.2)
            c.drawCentredString(x + box_w / 2, y + box_h - 18, title)
            c.setFillColor(INK)
            c.setFont("Helvetica", 7)
            for line_no, line in enumerate(detail.split("\n")):
                c.drawCentredString(x + box_w / 2, y + box_h - 42 - (line_no * 12), line)
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Oblique", 7.4)
        c.drawString(0, 12, "Status labels preserve context; they do not make a case for a preferred conclusion.")


class PmaScenarioDiagram(Diagram):
    def __init__(self):
        super().__init__(2.75 * inch)

    def draw(self):
        c, w, h = self.canv, self.width, self.height
        c.setFillColor(MUTED)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(0, h - 10, "WORKED EXAMPLE: PMA AVAILABILITY DECISION")
        steps = [
            ("Government outcome", "Reduce PMA service interruptions", SAND),
            ("MCP-PMA-001", "PMA modernization package", SKY),
            ("LM Objective", "MVI modernization", MINT),
            ("Effect", "Modify Platform: PMA\nAspect: availability and maintainability", colors.HexColor("#EAF0F4")),
            ("Release context", "Current PMA -> Future PMA", colors.HexColor("#F1F4F6")),
        ]
        y, x, box_w, box_h = h - 45, 36, w - 72, 24
        for i, (title, detail, fill) in enumerate(steps):
            rounded_box(c, x, y, box_w, box_h, fill)
            c.setFillColor(NAVY)
            c.setFont("Helvetica-Bold", 7.4)
            c.drawString(x + 10, y + 17, title)
            c.setFont("Helvetica", 7.4)
            c.setFillColor(INK)
            c.drawRightString(x + box_w - 10, y + 17, detail.split("\n")[0])
            if len(detail.split("\n")) > 1:
                c.drawRightString(x + box_w - 10, y + 8, detail.split("\n")[1])
            if i < len(steps) - 1:
                arrow(c, w / 2, y - 2, w / 2, y - 8)
            y -= 32
        c.setFillColor(RED)
        c.setFont("Helvetica-Bold", 7.3)
        c.drawString(36, 6, "Do not add every installed Product or baseline row unless the Change Request explicitly affects it.")


def make_styles():
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("GuideTitle", parent=base["Title"], fontName="Helvetica-Bold", fontSize=27, leading=31, textColor=NAVY, alignment=TA_LEFT, spaceAfter=14),
        "subtitle": ParagraphStyle("GuideSubtitle", parent=base["BodyText"], fontName="Helvetica", fontSize=12, leading=17, textColor=BLUE, spaceAfter=18),
        "h1": ParagraphStyle("GuideH1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=18, leading=23, textColor=NAVY, spaceBefore=14, spaceAfter=9, keepWithNext=True),
        "h2": ParagraphStyle("GuideH2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=12.8, leading=16, textColor=BLUE, spaceBefore=12, spaceAfter=6, keepWithNext=True),
        "body": ParagraphStyle("GuideBody", parent=base["BodyText"], fontName="Helvetica", fontSize=9.2, leading=13.2, textColor=INK, spaceAfter=6),
        "small": ParagraphStyle("GuideSmall", parent=base["BodyText"], fontName="Helvetica", fontSize=7.6, leading=10.2, textColor=MUTED),
        "bullet": ParagraphStyle("GuideBullet", parent=base["BodyText"], fontName="Helvetica", fontSize=9.1, leading=13.1, leftIndent=14, firstLineIndent=-8, textColor=INK, spaceAfter=3),
        "callout": ParagraphStyle("GuideCallout", parent=base["BodyText"], fontName="Helvetica", fontSize=9.2, leading=13.2, textColor=INK, leftIndent=10, rightIndent=10, spaceBefore=5, spaceAfter=5),
        "code": ParagraphStyle("GuideCode", parent=base["Code"], fontName="Courier", fontSize=7.9, leading=10.5, textColor=INK, leftIndent=10, rightIndent=10, spaceBefore=4, spaceAfter=6),
        "table": ParagraphStyle("GuideTable", parent=base["BodyText"], fontName="Helvetica", fontSize=7.8, leading=10.4, textColor=INK),
        "tablehead": ParagraphStyle("GuideTableHead", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=7.6, leading=9.5, textColor=WHITE),
    }


def p(text, style):
    return Paragraph(text, style)


def bullet(text, styles):
    return p(f"- {text}", styles["bullet"])


def callout(label, text, styles, fill=SAND):
    table = Table([[p(f"<b>{label}</b><br/>{text}", styles["callout"])]], colWidths=[6.8 * inch])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    return table


def info_table(headers, rows, widths, styles):
    data = [[p(header, styles["tablehead"]) for header in headers]]
    for row in rows:
        data.append([p(cell, styles["table"]) for cell in row])
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    commands = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    for row_index in range(1, len(data)):
        if row_index % 2 == 0:
            commands.append(("BACKGROUND", (0, row_index), (-1, row_index), colors.HexColor("#F6F9FA")))
    table.setStyle(TableStyle(commands))
    return table


def page_header_footer(canvas, doc):
    canvas.saveState()
    width, height = letter
    if doc.page == 1:
        canvas.setTitle("A2O Technical Baseline Manager User Guide")
        canvas.setAuthor("A2O Technical Baseline Manager")
        canvas.setSubject("Practical guide for loading data, connecting technical scope, and preparing leadership decisions")
    if doc.page > 1:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.55)
        canvas.line(0.55 * inch, height - 0.52 * inch, width - 0.55 * inch, height - 0.52 * inch)
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-Bold", 7.5)
        canvas.drawString(0.55 * inch, height - 0.4 * inch, "A2O TECHNICAL BASELINE MANAGER")
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.3)
        canvas.drawRightString(width - 0.55 * inch, height - 0.4 * inch, "User guide")
    canvas.setStrokeColor(LINE)
    canvas.line(0.55 * inch, 0.47 * inch, width - 0.55 * inch, 0.47 * inch)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 7.2)
    canvas.drawString(0.55 * inch, 0.32 * inch, "Local Government analytical baseline - selected files only - no outbound application calls")
    canvas.drawRightString(width - 0.55 * inch, 0.32 * inch, f"Page {doc.page}")
    canvas.restoreState()


def build():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    styles = make_styles()
    frame = Frame(0.55 * inch, 0.62 * inch, 6.9 * inch, 9.65 * inch, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc = BaseDocTemplate(str(OUTPUT), pagesize=letter, leftMargin=0.55 * inch, rightMargin=0.55 * inch, topMargin=0.65 * inch, bottomMargin=0.60 * inch)
    from reportlab.platypus import PageTemplate
    doc.addPageTemplates([PageTemplate(id="guide", frames=[frame], onPage=page_header_footer)])
    story = []

    story.extend([
        Spacer(1, 0.55 * inch),
        p("A2O Technical Baseline Manager", styles["title"]),
        p("Practical user guide for loading data, connecting technical scope, and preparing a first leadership decision", styles["subtitle"]),
        Spacer(1, 0.14 * inch),
        callout("START SMALL", "Build one decision vertical slice before trying to model the entire program. A usable first slice can be one Initiative, one Change Request, one LM Objective, one affected Platform, and the evidence that explains the connection.", styles, MINT),
        Spacer(1, 0.18 * inch),
        p("What this guide covers", styles["h2"]),
        bullet("How to load A2O, Change Request, and LM Objective data without changing source meaning.", styles),
        bullet("How to distinguish source claims, Government assessment, decisions, and acceptance.", styles),
        bullet("How to connect a proposed PMA modernization outcome to a Change Request, Objective, Platform, and evidence.", styles),
        bullet("How to prepare a clear one-pager without overstating unknown scope, dates, or funding.", styles),
        Spacer(1, 0.22 * inch),
        p("Worked example", styles["h2"]),
        p("The guide uses a hypothetical Government outcome: <b>Reduce PMA service interruptions through a future PMA modernization decision.</b> It is illustrative. Replace names, identifiers, releases, and statements with your approved source material.", styles["body"]),
        Spacer(1, 0.7 * inch),
        p("Version 1.0 | Meeting-readiness branch", styles["small"]),
        PageBreak(),

        p("1. Start with the operating boundary", styles["h1"]),
        p("The application is an editable Government analytical baseline. It preserves selected-source receipts and helps connect them to analysis and leadership decisions. It does not replace the contractor's source system or declare a source file to be an official program record.", styles["body"]),
        info_table(["Before a working session", "Why"], [
            ("Confirm the app is running at <b>http://127.0.0.1:3000</b>.", "The local runtime is loopback-only."),
            ("Keep source files in an approved local folder.", "The app reads the specific file you select; it does not fetch Confluence, GitLab, Lockheed, or another external system."),
            ("Run <font name='Courier'>npm run local:backup</font> before a major import and at end of session.", "The local database and uploaded evidence are operational data, not Git content."),
            ("Leave a date blank when it is not known.", "Blank means not established. It is more accurate than an invented placeholder."),
        ], [2.62 * inch, 4.18 * inch], styles),
        Spacer(1, 0.18 * inch),
        DataChainDiagram(),
        Spacer(1, 0.08 * inch),
        callout("FIRST QUESTION", "Before adding data, write a single sentence: What Government decision needs better technical evidence? Example: Should the Government direct and fund a bounded PMA modernization package to reduce service interruptions?", styles, SAND),
        PageBreak(),

        p("2. Understand the relationships before entering them", styles["h1"]),
        p("The data becomes useful when the connections are explicit. A title that happens to match another title is not a relationship. Select the related governed record or create the correct one.", styles["body"]),
        RelationshipDiagram(),
        p("Use the relationships for their actual purpose:", styles["h2"]),
        info_table(["Relationship", "Use it for", "Do not use it for"], [
            ("Initiative -> Change Request", "Grouping funding or direction units under a Government outcome.", "A statement that every item in a release is automatically in scope."),
            ("Change Request -> technical effect", "A bounded action on a Product, Platform, configuration node, baseline record, Release, or Organization.", "A vague implementation narrative without an affected object."),
            ("Change Request -> LM Objective", "The accountable Objective delivery relationship.", "Treating every reported JPO/MCP reference as ownership."),
            ("Objective -> technical effect attribution", "Showing which effect the Objective implements.", "Replacing ownership or a dependency record."),
            ("Evidence record -> governed object", "Making the source or assessment discoverable with the thing it supports.", "Duplicating the object in free text."),
        ], [1.55 * inch, 2.65 * inch, 2.60 * inch], styles),
        Spacer(1, 0.16 * inch),
        callout("SCOPE RULE", "Initiative technical scope is derived from the affected objects on linked Change Requests and Objective effect attributions. The optional Release lens organizes the decision view; it does not turn every baseline record in that release into scope.", styles, MINT),
        PageBreak(),

        p("3. Read claims, analysis, decisions, and acceptance correctly", styles["h1"]),
        p("The labels are factual context. They tell a reader what kind of information they are viewing rather than trying to persuade them that it is good or bad.", styles["body"]),
        InformationStatesDiagram(),
        info_table(["When you see", "Interpret it as", "Next useful action"], [
            ("Source claim", "What an external source or supplier reported.", "Retain the receipt and compare it to the prior observation."),
            ("Government assessment", "Analysis, uncertainty, or an analyst judgment.", "Link the basis and identify what would confirm or reject it."),
            ("Government decision", "An adjudicated direction only when authority, date, and rationale are present.", "Retain the decision record and its affected links."),
            ("Integrity sealed file", "The retained bytes match the recorded file.", "Link it to a criterion or signoff before calling it acceptance evidence."),
        ], [1.45 * inch, 2.45 * inch, 2.90 * inch], styles),
        Spacer(1, 0.16 * inch),
        callout("EVIDENCE RECORD", "When creating a call, risk, question, technical note, or decision, set Information origin independently from Record lifecycle. For an approved decision, enter the decision authority, date, and rationale. A lifecycle value alone is not an adjudicated decision.", styles, SAND),
        PageBreak(),

        p("4. Worked example: PMA availability decision", styles["h1"]),
        p("Use an outcome-oriented Initiative name when possible. Instead of only naming a solution, state the operational result the Government seeks.", styles["body"]),
        PmaScenarioDiagram(),
        info_table(["Record", "Example entry", "Purpose"], [
            ("Initiative", "Reduce PMA service interruptions", "Government outcome and leadership decision context."),
            ("Decision ask", "Direct and fund a bounded PMA modernization analysis and implementation package.", "Specific Government direction needed."),
            ("Change Request", "MCP-PMA-001 - PMA modernization package", "External work/funding reference."),
            ("LM Objective", "MVI modernization", "Incumbent delivery commitment owned by the Change Request."),
            ("Technical effect", "Modify Platform: PMA. Aspect: availability and maintainability.", "Actual technical scope."),
            ("Release context", "Current PMA Release -> Future PMA Release", "Effect context only, not automatic scope."),
        ], [1.25 * inch, 3.05 * inch, 2.50 * inch], styles),
        Spacer(1, 0.14 * inch),
        callout("WHOLE-PLATFORM CHANGE", "For a whole-platform modernization, select Platform -> PMA as the affected object. Do not select every installed Product merely because it is on PMA. Add a Product only when it changes in its own right, such as a replacement, version transition, or retirement.", styles, SAND),
        PageBreak(),

        p("5. Load data in the right order", styles["h1"]),
        p("Use Import Hub & Quality for selected local source files. Preview before you apply. The retained receipt and the review decision matter as much as the resulting canonical records.", styles["body"]),
        info_table(["File in hand", "Import Hub action", "What it provides"], [
            ("Current 24-column A2O XLSX", "Import A2O workbook", "Release, Product, baseline-record, and reported configuration context."),
            ("Confluence MCP/DSOR CSV or XLSX", "Import Change Request export", "Change Request references and source-controlled fields."),
            ("FOR_JPO.json", "Import Objective JSON", "LM Objective source observations, reported JPO/MCP references, dependency references, and deltas."),
            ("CAPES, JIRA, MCPS, or OBJS delivery CSV/XLSX", "Import daily delivery", "Source observations for capabilities, requests, or Objectives."),
        ], [1.85 * inch, 1.75 * inch, 3.20 * inch], styles),
        Spacer(1, 0.14 * inch),
        p("For every import", styles["h2"]),
        bullet("Identify the file and source-as-of date accurately.", styles),
        bullet("Review new, changed, unchanged, removed, and blocked items before mutation.", styles),
        bullet("Resolve a true invalid or duplicate identity; skip a row that should not change the analytical baseline.", styles),
        bullet("Apply approved rows, then inspect the relevant Change Request or Objective history.", styles),
        bullet("Treat a removed source item as historical evidence, not a deletion instruction for governed records.", styles),
        callout("LM OBJECTIVE CAUTION", "A reported JPO/MCP value is a trace reference. It does not automatically create Government ownership, funding approval, a delivery owner, or a fixed Release commitment.", styles, MINT),
        PageBreak(),

        p("6. Describe Platforms, nodes, VMs, and installations", styles["h1"]),
        p("Open Platforms, select the Platform and the Release you are describing. The model intentionally separates stable identity from Release-specific facts.", styles["body"]),
        info_table(["Stable identity", "Release-specific state"], [
            ("Node code, name, node type, serial number, manufacturer, hardware Product", "Parent placement, CPU cores, memory, storage, lifecycle, operating state, source reference, source date"),
            ("Create once", "Create or edit for each Release where the configuration differs"),
        ], [3.38 * inch, 3.38 * inch], styles),
        Spacer(1, 0.14 * inch),
        p("To edit CPU, memory, storage, or parent placement", styles["h2"]),
        bullet("Open the Platform and choose the intended Release.", styles),
        bullet("In Release node register, select <b>Edit capacity &amp; Release state</b>.", styles),
        bullet("Record the measured, reported, or planned value with its source basis and date.", styles),
        bullet("Save the state for that Release. Do not rewrite an earlier Release state.", styles),
        p("To add a virtual machine", styles["h2"]),
        bullet("Select <b>Add infrastructure node / VM</b> and choose <b>Virtual machine</b>.", styles),
        bullet("Select its host as parent in the selected Release.", styles),
        bullet("Add operating system, hypervisor, application, or other software as installed Products when known.", styles),
        callout("DO NOT INVENT CONFIGURATION", "A node, VM, container, connection, or Product installation should exist only when it is sourced or deliberately recorded as an assessment. Unknown is an acceptable state.", styles, SAND),
        PageBreak(),

        p("7. Complete Change Request analysis and dependencies", styles["h1"]),
        p("The external system remains authoritative for its own lifecycle. This app records Government priority, consequence, technical effects, dependencies, and the fund/defer/decline decision reference.", styles["body"]),
        info_table(["Minimum Change Request analysis", "What good looks like"], [
            ("External identifier, source system, source-as-of", "A reader can locate the source claim and date."),
            ("Government priority", "The current Government prioritization is visible and separate from source scoring."),
            ("Funded and deferred consequences", "The decision tradeoff is stated plainly."),
            ("Technical effects", "Each uses a selected affected object, action, aspect, value transition if known, and status."),
            ("Dependencies", "Material prerequisite or conflict has rationale, source, owner, and information status."),
        ], [2.20 * inch, 4.56 * inch], styles),
        Spacer(1, 0.15 * inch),
        info_table(["Relationship", "Use it when", "Example"], [
            ("Requires", "The successor cannot proceed without the predecessor.", "PMA fielding requires an approved environment change."),
            ("Enables", "The predecessor makes successor work possible or easier.", "Infrastructure assessment enables the PMA package."),
            ("Blocks", "The predecessor prevents successor work from progressing.", "An unresolved security exception blocks fielding."),
            ("Conflicts", "The requests compete or cannot coexist as planned.", "Two changes reserve the same maintenance window."),
            ("Overlaps", "Work shares scope or timing without a stronger dependency.", "Two analysis packages inspect PMA."),
        ], [1.12 * inch, 2.90 * inch, 2.74 * inch], styles),
        Spacer(1, 0.14 * inch),
        callout("FINISH-TO-FINISH", "Use the work-package dependency control for a true finish-to-finish scheduling constraint: the successor cannot finish until the predecessor finishes. Do not turn a vague note into a dependency; name the actual prerequisite and the consequence if it is unmet.", styles, MINT),
        PageBreak(),

        p("8. Create the Initiative and let scope derive", styles["h1"]),
        p("Create the Initiative after the first Change Request is meaningfully described. Enter the Government outcome, owner, priority, decision ask, desired outcome, and consequence if deferred. The optional Release lens is for the decision view, not a manual scope selector.", styles["body"]),
        p("Then link the Change Request, confirm the Objective ownership and effect attribution, and add requirements, milestones, acceptance criteria, evidence, and Government work packages as they become available.", styles["body"]),
        info_table(["If this is true", "Then do this"], [
            ("The whole PMA Platform changes", "Link Platform -> PMA to the Change Request as an affected object."),
            ("A specific Product changes", "Add the Product effect separately and describe the action and aspect."),
            ("Only a specific fielded row changes", "Link that baseline record explicitly; it will count in derived baseline scope."),
            ("Future dates are only proposed", "Leave unknown dates blank; retain the proposal as a source claim or assessment."),
            ("Objective work implements an effect", "Create the explicit Objective-effect attribution in Technical scope."),
        ], [2.26 * inch, 4.50 * inch], styles),
        Spacer(1, 0.16 * inch),
        callout("CHECK THE RESULT", "Open the Initiative and review Derived technical scope. For the PMA example, one Platform effect should appear as one affected Platform. It should not inflate to every Product or baseline record unless those objects were explicitly affected.", styles, SAND),
        Spacer(1, 0.13 * inch),
        p("Useful Initiative completion sequence", styles["h2"]),
        bullet("Link each decision-driving Change Request.", styles),
        bullet("Confirm Objectives are owned, and attribute the effects they implement.", styles),
        bullet("Add requirements and Tier 3/Tier 4 acceptance criteria only when the actual statements and evidence paths are known.", styles),
        bullet("Expose unknowns as readiness gaps rather than hiding them in a generic note.", styles),
        PageBreak(),

        p("9. Prepare the first leadership one-pager", styles["h1"]),
        p("A good first one-pager is not a complete implementation plan. It is a reproducible statement of the decision, known technical scope, linked evidence, and material gaps.", styles["body"]),
        info_table(["One-pager element", "Ready when"], [
            ("Decision", "The action, authority, and decision-needed date are plain language."),
            ("As-Is", "The current condition is sourced or clearly shown as an assessment/gap."),
            ("To-Be", "The target is bounded and not presented as already funded."),
            ("Change Requests", "Each decision unit has a consequence and at least one useful technical effect."),
            ("Objectives", "Each is owned and attributed to a technical effect where applicable."),
            ("Technical scope", "Derived affected objects match the decision; release context does not overclaim scope."),
            ("Evidence and acceptance", "Evidence is linked, and a seal is not misrepresented as acceptance."),
        ], [1.65 * inch, 5.11 * inch], styles),
        Spacer(1, 0.15 * inch),
        p("Suggested first narrative", styles["h2"]),
        callout("PMA EXAMPLE", "The Government needs direction on a bounded PMA modernization package. Supplier-reported planning and technical scope require validation. The Initiative currently identifies the PMA Platform as the affected object; individual Product and baseline-record effects will be added only when supported by Change Request analysis.", styles, MINT),
        Spacer(1, 0.15 * inch),
        bullet("Use <b>Open leadership one-pager</b> for the current live decision sheet.", styles),
        bullet("Use <b>Save report snapshot</b> when the current content should become a frozen, auditable record.", styles),
        bullet("Include the traceability annex when necessary detail does not fit on the first page.", styles),
        callout("FROZEN MEANS FROZEN", "A saved report does not silently change when source observations, effects, or analysis are edited later. Create a new snapshot when a later state should be briefed.", styles, SAND),
        PageBreak(),

        p("10. Daily and meeting rhythm", styles["h1"]),
        p("Use a repeatable cadence so that incoming source changes become visible, assessable, and traceable rather than getting lost in email or standups.", styles["body"]),
        info_table(["Moment", "Repeatable action"], [
            ("Daily source intake", "Save the received file unchanged, import it, review the preview, apply approved rows, and inspect retained deltas."),
            ("Before a technical touchpoint", "Open the Change Request, Objective, Platform, and Release. Separate reported dependencies from accepted Government dependencies."),
            ("During/after the touchpoint", "Create an Evidence record for material facts, assessments, questions, actions, and decisions. Link it to the affected objects."),
            ("Before leadership", "Review derived scope, evidence labels, decision consequence, readiness gaps, and the live one-pager."),
            ("End of session", "Export when needed, run <font name='Courier'>npm run local:backup</font>, and copy the result to an approved location."),
        ], [1.55 * inch, 5.21 * inch], styles),
        Spacer(1, 0.18 * inch),
        p("Common corrections", styles["h2"]),
        info_table(["Situation", "Correct action"], [
            ("A reported JPO changed", "Import the observation, inspect the retained delta, and do not overwrite Government ownership automatically."),
            ("A date is unknown", "Leave it blank and record the uncertainty or source claim."),
            ("A whole Platform is affected", "Link the Platform; add Products only when individually affected."),
            ("A source file is attached", "Set the record information origin and link a criterion/signoff before claiming acceptance."),
            ("Scope changed without notice", "Retain the new source snapshot, inspect the history, and make an assessment or decision record when material."),
        ], [1.70 * inch, 5.06 * inch], styles),
        PageBreak(),
    ])

    story.append(p("11. End-of-session checklist", styles["h1"]))
    checklist = [
        "Reviewed import results and blocking findings.",
        "Confirmed material Change Request effects point to selected real objects.",
        "Confirmed Objectives are owned and attributed where required.",
        "Kept uncertain information labeled as a source claim or Government assessment.",
        "Recorded authority, date, and rationale for every approved decision record.",
        "Saved a leadership snapshot only when the source state is ready to retain.",
        "Ran npm run local:backup and copied the backup to an approved location.",
    ]
    for item in checklist:
        story.append(p(f"[ ] {item}", styles["bullet"]))
    story.extend([
        Spacer(1, 0.22 * inch),
        p("Reference material in this repository", styles["h2"]),
        info_table(["File", "Use it for"], [
            ("README.md", "Local setup, updates, backups, and operating boundaries."),
            ("docs/GOVERNED_IMPORTS.md", "Import rules, review behavior, and source adapters."),
            ("docs/AUTHORITATIVE_DATA_MODEL.md", "Object ownership, relationships, and deliberate boundaries."),
            ("docs/INFRASTRUCTURE_CONFIGURATION_MODEL.md", "Platforms, nodes, VMs, installations, and connections."),
            ("docs/LOCAL_OPERATOR_RUNBOOK.md", "Detailed operator, update, transfer, backup, and recovery procedures."),
        ], [2.48 * inch, 4.28 * inch], styles),
        Spacer(1, 0.34 * inch),
        callout("USEFUL, NOT OVERSTATED", "The goal is to make the data, its source, its relationships, and its gaps visible. A smaller accurate decision slice is more valuable than a complete-looking model with unsupported scope or assumptions.", styles, MINT),
    ])
    doc.build(story)
    print(OUTPUT)


if __name__ == "__main__":
    build()
