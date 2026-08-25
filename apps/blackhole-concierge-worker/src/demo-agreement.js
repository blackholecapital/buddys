function escPdf(value = "") {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 180);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function rgb(hex) {
  const h = String(hex).replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function colorCmd(hex, stroke = false) {
  const values = rgb(hex).map((n) => Number(n.toFixed(4)));
  return `${values[0]} ${values[1]} ${values[2]} ${stroke ? "RG" : "rg"}`;
}

function text(x, y, size, value, font = "F1", color = "#111111") {
  return `BT /${font} ${size} Tf ${colorCmd(color)} ${x} ${y} Td (${escPdf(value)}) Tj ET`;
}

function line(x1, y1, x2, y2, color = "#cfdcf5", width = 1) {
  return `${colorCmd(color, true)} ${width} w ${x1} ${y1} m ${x2} ${y2} l S`;
}

function rect(x, y, width, height, fill = "#ffffff", stroke = "#cfdcf5") {
  return `${colorCmd(fill)} ${x} ${y} ${width} ${height} re f ${colorCmd(stroke, true)} 1 w ${x} ${y} ${width} ${height} re S`;
}

function fillRect(x, y, width, height, fill) {
  return `${colorCmd(fill)} ${x} ${y} ${width} ${height} re f`;
}

function field(commands, x, y, width, label, value) {
  commands.push(text(x, y + 32, 7, label, "F2", "#5c6f91"));
  commands.push(rect(x, y, width, 28));
  commands.push(text(x + 8, y + 9, 10, value, "F1", "#111111"));
}

function buildPdfBytes({ contact = {}, product = {}, selectionNumber = 1, agreementId = "DEMO-PENDING" } = {}) {
  const fullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Customer";
  const commands = [];

  commands.push(fillRect(0, 637, 612, 155, "#214b9f"));
  commands.push(fillRect(38, 672, 56, 56, "#ffe52f"));
  commands.push(text(56, 690, 28, "B", "F2", "#10245b"));
  commands.push(text(112, 714, 20, "BUDDY'S HOME FURNISHINGS", "F2", "#ffffff"));
  commands.push(text(112, 692, 12, "Rental-Purchase Demo Agreement", "F1", "#ffffff"));
  commands.push(text(448, 730, 8, "DEMONSTRATION DOCUMENT", "F2", "#ffffff"));
  commands.push(text(448, 714, 7, "DocuSign test environment", "F1", "#ffffff"));

  commands.push(rect(438, 652, 140, 44, "#ffffff", "#ffffff"));
  commands.push(text(448, 678, 7, "AGREEMENT ID", "F2", "#5c6f91"));
  commands.push(text(448, 660, 8, agreementId, "F2", "#10245b"));

  commands.push(text(38, 592, 14, "Customer & Contact", "F2", "#10245b"));
  commands.push(line(38, 584, 574, 584));
  field(commands, 38, 526, 250, "CUSTOMER NAME", fullName);
  field(commands, 330, 526, 244, "PHONE", contact.phone || "");
  field(commands, 38, 476, 250, "EMAIL", contact.email || "");
  field(commands, 330, 476, 244, "STATE / AREA", contact.location || "");

  commands.push(text(38, 412, 14, "Selected Product", "F2", "#10245b"));
  commands.push(line(38, 404, 574, 404));
  field(commands, 38, 346, 190, "CATEGORY", contact.interest || product.category || "");
  field(commands, 244, 346, 330, "SELECTED ITEM", product.name || "");
  field(commands, 38, 296, 110, "OPTION", String(selectionNumber));
  field(commands, 164, 296, 110, "LEAD SCORE", String(contact.leadScore ?? ""));

  commands.push(fillRect(38, 176, 536, 88, "#f5f8ff"));
  commands.push(text(50, 242, 10, "Demo transaction acknowledgement", "F2", "#10245b"));
  const notes = [
    "- This document is used only to demonstrate Buddy's automated sales workflow.",
    "- No payment information is collected by this demo agreement.",
    "- Signing confirms the selected demo item and allows delivery scheduling to continue.",
    "- This is not a binding retail rental-purchase agreement and creates no purchase obligation.",
  ];
  notes.forEach((note, index) => commands.push(text(50, 222 - index * 13, 8, note, "F1", "#5c6f91")));

  commands.push(text(38, 138, 14, "Customer Acceptance", "F2", "#10245b"));
  commands.push(line(38, 130, 574, 130));
  commands.push(text(50, 104, 7, "CUSTOMER SIGNATURE", "F2", "#5c6f91"));
  commands.push(text(390, 104, 7, "DATE SIGNED", "F2", "#5c6f91"));
  commands.push(line(50, 58, 320, 58));
  commands.push(line(390, 58, 550, 58));

  commands.push(fillRect(0, 0, 612, 42, "#214b9f"));
  commands.push(text(38, 18, 8, "Buddy's Home Furnishings - Personal Shopper Demo", "F2", "#ffffff"));
  commands.push(text(372, 18, 7, "Powered by Buddy AI workflow - DocuSign + Google Calendar", "F1", "#ffffff"));

  const stream = commands.join("\n");
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>";
  objects[4] = `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`;
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[6] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  let pdf = "%PDF-1.4\n%BuddyDemo\n";
  const offsets = [0];
  for (let i = 1; i <= 6; i += 1) {
    offsets[i] = new TextEncoder().encode(pdf).length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xref = new TextEncoder().encode(pdf).length;
  pdf += "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function buildDemoEnvelope({ contact = {}, product = {}, selectionNumber = 1, agreementId = "DEMO-PENDING" } = {}) {
  const fullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Customer";
  const signerEmail = contact.email || "";
  const documentBase64 = bytesToBase64(buildPdfBytes({ contact, product, selectionNumber, agreementId }));

  return {
    emailSubject: `Buddy's Home Furnishings - Demo Agreement for ${product.name || contact.interest || "Your Selection"}`,
    status:"sent",
    documents:[{
      documentBase64,
      name:"Buddy's Demo Rental-Purchase Agreement.pdf",
      fileExtension:"pdf",
      documentId:"1",
    }],
    recipients:{
      signers:[{
        name:fullName,
        email:signerEmail,
        recipientId:"1",
        routingOrder:"1",
        tabs:{
          signHereTabs:[{
            documentId:"1",
            pageNumber:"1",
            xPosition:"58",
            yPosition:"704",
            scaleValue:"0.78",
          }],
          dateSignedTabs:[{
            documentId:"1",
            pageNumber:"1",
            xPosition:"394",
            yPosition:"704",
          }],
        },
      }],
    },
    eventNotification:{
      url:"{{CONNECT_WEBHOOK_URL}}",
      loggingEnabled:"true",
      requireAcknowledgment:"true",
      envelopeEvents:[
        { envelopeEventStatusCode:"sent" },
        { envelopeEventStatusCode:"delivered" },
        { envelopeEventStatusCode:"completed" },
        { envelopeEventStatusCode:"declined" },
        { envelopeEventStatusCode:"voided" },
      ],
    },
  };
}
