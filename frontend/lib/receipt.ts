import type { EnrollmentReceipt } from "@course-lms/shared";
import { formatCurrency, formatDateTime, formatMobile } from "./format";

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );

/**
 * A self-contained HTML receipt. No external assets, so it prints identically
 * offline and opens correctly from a downloaded file.
 */
export function buildReceiptHtml(receipt: EnrollmentReceipt): string {
  const { enrollment, payment, course, academy, issuedAt } = receipt;

  const row = (label: string, value: string, isStrong = false) => `
    <tr>
      <td class="label">${escapeHtml(label)}</td>
      <td class="value${isStrong ? " strong" : ""}">${escapeHtml(value)}</td>
    </tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Receipt ${escapeHtml(enrollment.enrollmentId)}</title>
<style>
  *{ box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px;
    font-family: "DM Sans", system-ui, -apple-system, sans-serif;
    background: #f2f4f7; color: #191c22;
    -webkit-font-smoothing: antialiased;
  }
  .sheet {
    max-width: 620px; margin: 0 auto; background: #fff;
    border-radius: 24px; padding: 40px;
  }
  .head { display: flex; align-items: center; gap: 12px; }
  .mark {
    width: 44px; height: 44px; border-radius: 10px;
    background: #3ee9be; color: #0b3b31;
    display: grid; place-items: center; font-size: 20px; font-weight: 700;
  }
  .academy { font-size: 20px; font-weight: 600; letter-spacing: -0.01em; }
  .tagline { font-size: 13px; color: #6b7280; margin-top: 2px; }
  h1 { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; margin: 28px 0 4px; }
  .sub { font-size: 15px; color: #6b7280; margin: 0; }
  .idbox {
    margin: 24px 0; padding: 18px; text-align: center;
    background: #edf0f4; border-radius: 16px;
  }
  .idbox span { font-size: 12px; color: #6b7280; letter-spacing: .04em; text-transform: uppercase; }
  .idbox strong {
    display: block; margin-top: 6px; font-size: 26px; font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 11px 0; border-bottom: 1px solid #e3e7ed; vertical-align: top; font-size: 15px; }
  tr:last-child td { border-bottom: 0; }
  .label { color: #6b7280; }
  .value { text-align: right; font-weight: 500; font-variant-numeric: tabular-nums; }
  .value.strong { font-weight: 700; font-size: 17px; }
  .paid {
    display: inline-block; padding: 4px 12px; border-radius: 999px;
    background: #e4f7ef; color: #0e9f6e; font-size: 13px; font-weight: 600;
  }
  footer {
    margin-top: 28px; padding-top: 20px; border-top: 1px solid #e3e7ed;
    font-size: 13px; color: #6b7280; line-height: 1.7;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .sheet { border-radius: 0; padding: 24px; max-width: none; }
    @page { margin: 14mm; }
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      <div class="mark">${escapeHtml(academy.name.charAt(0))}</div>
      <div>
        <div class="academy">${escapeHtml(academy.name)}</div>
        <div class="tagline">${escapeHtml(academy.tagline)}</div>
      </div>
    </div>

    <h1>Enrollment receipt</h1>
    <p class="sub">Thank you for enrolling.</p>

    <div class="idbox">
      <span>Enrollment ID</span>
      <strong>${escapeHtml(enrollment.enrollmentId)}</strong>
    </div>

    <table>
      ${row("Course", course.name)}
      ${row("Mode", course.mode)}
      ${row("Duration", course.durationLabel)}
      ${enrollment.batchLabel ? row("Batch", enrollment.batchLabel) : ""}
      ${row("Certificate", course.hasCertificate ? "Yes" : "No")}
      ${row("Student", enrollment.fullName)}
      ${row("Mobile", formatMobile(enrollment.mobile))}
      <tr>
        <td class="label">Payment status</td>
        <td class="value"><span class="paid">Paid</span></td>
      </tr>
      ${row("Payment method", payment.method.toUpperCase())}
      ${row("Payment reference", payment.reference)}
      ${payment.gatewayRef ? row("Transaction ID", payment.gatewayRef) : ""}
      ${row("Date & time", formatDateTime(payment.completedAt ?? payment.createdAt))}
      ${row("Amount paid", formatCurrency(payment.amount, payment.currency), true)}
    </table>

    <footer>
      ${escapeHtml(academy.address)}<br>
      ${academy.supportNumber ? `Support: ${escapeHtml(academy.supportNumber)}<br>` : ""}
      ${academy.email ? `${escapeHtml(academy.email)}<br>` : ""}
      Issued ${escapeHtml(formatDateTime(issuedAt))}
    </footer>
  </div>
</body>
</html>`;
}

export function downloadReceipt(html: string, enrollmentId: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `receipt-${enrollmentId}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Prints via a hidden iframe rather than window.open — kiosk browsers usually
 * run with popups blocked, and this keeps the flow on screen.
 *
 * Resolves once printing finishes (or the dialog is dismissed). Callers use
 * that to hold the auto-return countdown until the receipt is out.
 *
 * With Chrome's `--kiosk-printing` flag this prints silently to the default
 * printer; without it the browser shows its usual print dialog.
 */
export function printReceipt(html: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      // Delay removal so the print job has read the document.
      setTimeout(() => frame.remove(), 500);
      resolve();
    };

    const doc = frame.contentWindow?.document;
    if (!doc) {
      frame.remove();
      resolve();
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      win.addEventListener("afterprint", cleanup, { once: true });
      // Safety net: some browsers never fire afterprint for a hidden frame.
      setTimeout(cleanup, 12_000);

      try {
        win.focus();
        win.print();
      } catch {
        cleanup();
      }
    };

    // If the iframe never loads at all, don't hang the caller forever.
    setTimeout(cleanup, 15_000);
  });
}
