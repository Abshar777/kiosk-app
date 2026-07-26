"use client";

import { Drawer, Modal, useMediaQuery } from "@heroui/react";
import { createContext, useContext } from "react";

/**
 * One overlay API, two presentations: a centred Modal on tablet/desktop and a
 * bottom Drawer (sheet) on phones, which is what a thumb expects on a small
 * screen.
 *
 * Call sites use `<ResponsiveDialog>` plus `Dialog.Header/Body/Footer/...`;
 * this module swaps in the matching HeroUI parts underneath, so no screen has
 * to branch on viewport itself.
 */

const MOBILE_QUERY = "(max-width: 767px)";

const SheetContext = createContext(false);

/** True when the surrounding dialog is presented as a mobile drawer. */
export const useIsSheet = () => useContext(SheetContext);

export function ResponsiveDialog({
  isOpen,
  onOpenChange,
  isDismissable = true,
  className,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isDismissable?: boolean;
  /** Applied to the dialog surface in both presentations. */
  className?: string;
  children: React.ReactNode;
}) {
  // `initializeWithValue: false` avoids an SSR/client mismatch — the server has
  // no viewport, so the first paint is always the desktop branch.
  const isSheet = useMediaQuery(MOBILE_QUERY, { initializeWithValue: false });

  if (isSheet) {
    return (
      <SheetContext.Provider value>
        <Drawer.Backdrop
          isDismissable={isDismissable}
          isOpen={isOpen}
          onOpenChange={onOpenChange}
        >
          <Drawer.Content placement="bottom">
            {/*
             * A floating sheet rather than an edge-to-edge one: inset from the
             * screen edges and rounded on all four corners, so it reads as the
             * same card the desktop modal is. `overflow-hidden` (from the
             * caller's className) clips the hero image to those corners.
             */}
            <Drawer.Dialog
              className={`mx-3 mb-3 flex max-h-[88dvh] flex-col rounded-[var(--radius-card)] ${
                className ?? ""
              }`}
            >
              <Drawer.Handle className="shrink-0" />
              {children}
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </SheetContext.Provider>
    );
  }

  return (
    <SheetContext.Provider value={false}>
      <Modal.Backdrop
        isDismissable={isDismissable}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
      >
        <Modal.Container className="p-4" placement="center" scroll="inside">
          <Modal.Dialog className={className}>{children}</Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </SheetContext.Provider>
  );
}

type PartProps = { className?: string; children?: React.ReactNode };

/**
 * Parts that resolve to Modal.* or Drawer.* depending on the presentation.
 * Both sets are styled compatibly, so a screen's markup never changes.
 */
export const Dialog = {
  Header: ({ className, children }: PartProps) => {
    const Part = useIsSheet() ? Drawer.Header : Modal.Header;
    return <Part className={className}>{children}</Part>;
  },

  Heading: ({ className, children }: PartProps) => {
    const Part = useIsSheet() ? Drawer.Heading : Modal.Heading;
    return <Part className={className}>{children}</Part>;
  },

  Body: ({ className, children }: PartProps) => {
    const Part = useIsSheet() ? Drawer.Body : Modal.Body;
    return <Part className={className}>{children}</Part>;
  },

  Footer: ({ className, children }: PartProps) => {
    const Part = useIsSheet() ? Drawer.Footer : Modal.Footer;
    return <Part className={className}>{children}</Part>;
  },

  CloseTrigger: ({
    className,
    "aria-label": ariaLabel,
  }: {
    className?: string;
    "aria-label"?: string;
  }) => {
    const Part = useIsSheet() ? Drawer.CloseTrigger : Modal.CloseTrigger;
    return <Part aria-label={ariaLabel} className={className} />;
  },
};
