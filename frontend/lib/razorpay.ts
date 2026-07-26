import type { PaymentIntent } from "@course-lms/shared";

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  close(): void;
  on(event: string, handler: (payload: { error?: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loader: Promise<void> | null = null;

/** Loads Razorpay Checkout once and reuses the same promise thereafter. */
export function loadRazorpay(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.Razorpay) return Promise.resolve();
  if (loader) return loader;

  loader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHECKOUT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("load failed")));
      return;
    }

    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loader = null;
      reject(new Error("Could not load the payment gateway"));
    };
    document.head.appendChild(script);
  });

  return loader;
}

/** Razorpay Checkout mounts these at document.body level. */
const GATEWAY_SELECTOR = ".razorpay-container, .razorpay-backdrop, .razorpay-checkout-frame";

/**
 * Keeps the gateway's overlay interactive while our own dialog is open.
 *
 * Our flow runs inside a React Aria modal, and React Aria's `ariaHideOutside`
 * marks everything outside the dialog as `inert` — including nodes added
 * *later*, which is exactly what Razorpay does. An inert subtree ignores every
 * click and touch, so the checkout renders but cannot be used.
 *
 * React Aria deliberately skips elements tagged `data-react-aria-top-layer`,
 * so we tag the gateway's nodes and clear any inert flag already applied. The
 * observer re-asserts it because React Aria's own observer may run first.
 *
 * The alternative — closing our dialog for the duration — would unmount the
 * flow and lose the student's details.
 */
function keepGatewayInteractive(): () => void {
  const release = (element: HTMLElement) => {
    element.setAttribute("data-react-aria-top-layer", "true");
    if (element.inert) element.inert = false;
    if (element.getAttribute("aria-hidden") === "true") {
      element.removeAttribute("aria-hidden");
    }
  };

  const sweep = () => {
    document.querySelectorAll<HTMLElement>(GATEWAY_SELECTOR).forEach(release);
  };

  sweep();
  const observer = new MutationObserver(sweep);
  observer.observe(document.body, {
    attributeFilter: ["inert", "aria-hidden"],
    attributes: true,
    childList: true,
    subtree: true,
  });

  return () => observer.disconnect();
}

export type CheckoutOutcome =
  | { status: "success"; payload: RazorpaySuccess }
  | { status: "failed"; reason: string }
  | { status: "dismissed" };

/**
 * Opens Razorpay Checkout and resolves once the student finishes, fails or
 * closes it. The returned payload is *not* trusted — the server re-verifies the
 * signature before anything is recorded.
 */
export function openRazorpayCheckout(
  intent: PaymentIntent,
  options: { themeColor?: string; description?: string } = {},
): Promise<CheckoutOutcome> {
  return new Promise((resolve) => {
    if (!window.Razorpay || !intent.orderId || !intent.publicKey) {
      resolve({ status: "failed", reason: "Payment gateway is unavailable" });
      return;
    }

    const stopKeepingInteractive = keepGatewayInteractive();

    let settled = false;
    const settle = (outcome: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      stopKeepingInteractive();
      resolve(outcome);
    };

    const checkout = new window.Razorpay({
      key: intent.publicKey,
      order_id: intent.orderId,
      // Razorpay works in the smallest currency unit.
      amount: Math.round(intent.amount * 100),
      currency: intent.currency,
      name: intent.academyName,
      description: options.description ?? intent.courseName,
      prefill: {
        name: intent.prefill.name,
        contact: intent.prefill.contact,
      },
      notes: { enrollmentId: intent.enrollmentId },
      theme: { color: options.themeColor ?? "#3f4857" },
      // A kiosk has no email inbox to check; keep the student on screen.
      modal: {
        escape: true,
        ondismiss: () => settle({ status: "dismissed" }),
      },
      handler: (payload: RazorpaySuccess) => settle({ status: "success", payload }),
    });

    checkout.on("payment.failed", (event) => {
      settle({
        status: "failed",
        reason: event.error?.description ?? "The payment was declined",
      });
    });

    checkout.open();
  });
}
