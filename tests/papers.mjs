// ══════════════════════════════════════════════════════════════
// Documents built to be wrong in one specific way each.
//
// The scanning engine claims that an altered PDF remembers being
// altered, that a fabricated one fails to add up, and that a reused
// one matches something already on file. Those are claims about files,
// and the only way to check a claim about files is to build files
// whose answer is known before the scanner sees them.
//
// So these are real PDFs — a real header, real objects, a real
// cross-reference table, real content streams — assembled here rather
// than fetched, so each fixture differs from the clean one in exactly
// one respect and nothing else can explain the finding.
// ══════════════════════════════════════════════════════════════

export const PAPERS = String.raw`
  window.pdfBuilder = function pdfBuilder() {
    const enc = new TextEncoder();

    // A content stream: lines of text, each with the font it is drawn
    // in, positioned down the page the way a real generator does it.
    function contentStream(lines) {
      let out = 'BT\n';
      let y = 780;
      for (const line of lines) {
        const parts = Array.isArray(line) ? line : [{ font: 'F1', size: 11, text: line }];
        out += '1 0 0 1 60 ' + y + ' Tm\n';
        let dx = 0;
        for (const p of parts) {
          out += '/' + p.font + ' ' + p.size + ' Tf\n';
          if (dx) out += dx + ' 0 Td\n';
          out += '(' + String(p.text).replace(/([()\\])/g, '\\$1') + ') Tj\n';
          dx = p.advance ?? 0;
        }
        y -= 22;
      }
      out += 'ET\n';
      return out;
    }

    async function deflate(bytes) {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    // The file itself. Objects are laid out in order and the
    // cross-reference table records where each one starts, which is
    // what makes this a PDF rather than something shaped like one.
    async function build({ lines, fonts = ['Helvetica'], meta = {}, compress = false }) {
      const content = contentStream(lines);
      const body = compress ? await deflate(enc.encode(content)) : enc.encode(content);

      const fontObjs = fonts.map((f, i) =>
        (5 + i) + ' 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /' + f + ' >>\nendobj\n');
      const fontRes = fonts.map((f, i) => '/F' + (i + 1) + ' ' + (5 + i) + ' 0 R').join(' ');
      const infoNum = 5 + fonts.length;

      const infoParts = [];
      if (meta.producer) infoParts.push('/Producer (' + meta.producer + ')');
      if (meta.creator) infoParts.push('/Creator (' + meta.creator + ')');
      if (meta.created) infoParts.push('/CreationDate (D:' + meta.created + ')');
      if (meta.modified) infoParts.push('/ModDate (' + 'D:' + meta.modified + ')');

      const objects = [
        '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
        '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
        '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
          + '/Resources << /Font << ' + fontRes + ' >> >> /Contents 4 0 R >>\nendobj\n',
        null, // the content stream, spliced in as bytes below
        ...fontObjs,
      ];
      if (infoParts.length) objects.push(infoNum + ' 0 obj\n<< ' + infoParts.join(' ') + ' >>\nendobj\n');

      const chunks = [];
      const offsets = [];
      let at = 0;
      const push = (bytes) => { chunks.push(bytes); at += bytes.length; };

      push(enc.encode('%PDF-1.7\n%âãÏÓ\n'));

      for (let i = 0; i < objects.length; i++) {
        offsets.push(at);
        if (objects[i] === null) {
          const head = '4 0 obj\n<< /Length ' + body.length
            + (compress ? ' /Filter /FlateDecode' : '') + ' >>\nstream\n';
          push(enc.encode(head));
          push(body);
          push(enc.encode('\nendstream\nendobj\n'));
        } else {
          push(enc.encode(objects[i]));
        }
      }

      const xrefAt = at;
      let xref = 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
      for (const o of offsets) xref += String(o).padStart(10, '0') + ' 00000 n \n';
      xref += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R'
        + (infoParts.length ? ' /Info ' + infoNum + ' 0 R' : '') + ' >>\n'
        + 'startxref\n' + xrefAt + '\n%%EOF\n';
      push(enc.encode(xref));

      const total = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(total);
      let p = 0;
      for (const c of chunks) { out.set(c, p); p += c.length; }
      return out;
    }

    // Somebody opened the document, changed a line, and saved. The
    // original body stays exactly where it was — a PDF saved again
    // APPENDS — so the file now contains both versions, a second
    // cross-reference section pointing back at the first, and a second
    // end-of-file marker. This is what an edited document is.
    async function saveAgain(original, { lines, fontIndex = 1, modified }) {
      const content = contentStream(lines);
      const body = enc.encode(content);
      const head = enc.encode('\n4 0 obj\n<< /Length ' + body.length + ' >>\nstream\n');
      const tail = enc.encode('\nendstream\nendobj\n');

      const infoBytes = enc.encode(
        '9 0 obj\n<< /Producer (Adobe Acrobat Pro 24.2) /ModDate (D:' + modified + ') >>\nendobj\n');

      const at = original.length;
      const contentAt = at + 1;
      const infoAt = at + head.length + body.length + tail.length;

      const xref = enc.encode(
        'xref\n0 1\n0000000000 65535 f \n'
        + '4 1\n' + String(contentAt).padStart(10, '0') + ' 00000 n \n'
        + '9 1\n' + String(infoAt).padStart(10, '0') + ' 00000 n \n'
        + 'trailer\n<< /Size 10 /Root 1 0 R /Info 9 0 R /Prev 0 >>\n'
        + 'startxref\n' + (infoAt + infoBytes.length) + '\n%%EOF\n');

      const total = original.length + head.length + body.length + tail.length
        + infoBytes.length + xref.length;
      const out = new Uint8Array(total);
      let p = 0;
      for (const part of [original, head, body, tail, infoBytes, xref]) { out.set(part, p); p += part.length; }
      return out;
    }

    return { build, saveAgain, contentStream };
  };

  // ── The fixtures ───────────────────────────────────────────────
  window.papers = async function papers() {
    const { build, saveAgain } = window.pdfBuilder();
    const file = (bytes, name) => new File([bytes], name, { type: 'application/pdf' });

    const payslipLines = (net) => [
      'ACME LOGISTICS (PTY) LTD',
      'Payslip for the period ending 30 September 2026',
      'Employee   T MOKOENA          Employee No 44821',
      'Gross Pay                       25 000.00',
      'PAYE                             4 100.00',
      'UIF                                177.12',
      'Pension                            922.88',
      'Total Deductions                 5 200.00',
      'Net Pay                         ' + net,
      'Paid by electronic transfer on 25 September 2026',
    ];

    // The honest one. Written once, by a payroll system, in one font,
    // and it adds up: 25 000 less 5 200 is 19 800.
    const clean = await build({
      lines: payslipLines('19 800.00'),
      meta: {
        producer: 'Sage 300 People Payroll Engine 24.1',
        creator: 'Sage 300 People',
        created: '20260925T083000Z'.replace('T', '').replace('Z', ''),
        modified: '20260925083000',
      },
    });

    // The same document, compressed the way most real generators emit
    // it. Nothing about it is wrong; it is here to prove the reader
    // can inflate a content stream at all.
    const compressed = await build({
      lines: payslipLines('19 800.00'),
      meta: {
        producer: 'Sage 300 People Payroll Engine 24.1',
        created: '20260925083000', modified: '20260925083000',
      },
      compress: true,
    });

    // Opened, the net pay changed, saved. Three things give it away at
    // once: the file now has two revisions, the modification date is a
    // fortnight after the creation date, and the number that changed
    // is set in a face used nowhere else on the page.
    const tampered = await saveAgain(clean, {
      lines: payslipLines('29 800.00').map((l) =>
        l.startsWith('Net Pay')
          ? [{ font: 'F1', size: 11, text: 'Net Pay' },
             { font: 'F2', size: 11, text: '29 800.00', advance: 210 }]
          : l),
      modified: '20261009141500',
    });

    // Never a real document at all: built in an image editor. It adds
    // up, because whoever made it did the arithmetic — which is
    // exactly why the arithmetic cannot be the only check.
    const fabricated = await build({
      lines: payslipLines('19 800.00'),
      meta: {
        producer: 'Adobe Photoshop 25.9 (Windows)',
        creator: 'Adobe Photoshop',
        created: '20261002110000', modified: '20261002113000',
      },
    });

    // The same statement, re-exported by something else: different
    // bytes, different producer, different fonts, same words.
    const reExported = await build({
      lines: payslipLines('19 800.00'),
      fonts: ['Times-Roman'],
      meta: { producer: 'LibreOffice 7.6', created: '20261003090000', modified: '20261003090000' },
    });

    // Stripped of everything that says where it came from.
    const anonymous = await build({ lines: payslipLines('19 800.00'), meta: {} });

    return {
      clean: file(clean, 'payslip-september.pdf'),
      compressed: file(compressed, 'payslip-september-compressed.pdf'),
      tampered: file(tampered, 'payslip-september-edited.pdf'),
      fabricated: file(fabricated, 'payslip-built.pdf'),
      reExported: file(reExported, 'payslip-reexported.pdf'),
      anonymous: file(anonymous, 'payslip-anonymous.pdf'),
    };
  };
`;
