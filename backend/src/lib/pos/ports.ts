import type { SerialPortInfo } from '@course-lms/shared';
import { SerialPort } from 'serialport';

/**
 * Lists serial devices for the admin "Card terminal" settings dropdown, so the
 * operator picks a port instead of typing `/dev/tty.usbmodem14201` by hand.
 *
 * Never throws. Enumeration goes through a native binding and depends on OS
 * services that can be absent or refuse to answer — udev on a slim Linux
 * image, WMI on Windows — and a settings page that still renders with an empty
 * dropdown (and a free-text fallback) is far better than one that 500s.
 */
export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  try {
    const ports = await SerialPort.list();
    return ports.map((port) => ({
      path: port.path,
      // The bindings guarantee `path` only; everything else is undefined when
      // the OS does not expose it. Our shape uses null, so normalise.
      manufacturer: port.manufacturer ?? null,
      serialNumber: port.serialNumber ?? null,
    }));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[pos/ports] could not enumerate serial ports: ${reason}`);
    return [];
  }
}
