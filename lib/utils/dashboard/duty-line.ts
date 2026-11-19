/**
 * How a gate reads on the dashboard's aircraft card. (The duty band's line
 * under the chain that lived here went with the Nov 2026 redesign: the
 * aircraft area says where the aeroplane is — `area-status.ts`.)
 */


/**
 * "D41 · T1" — a gate and its terminal, as far as either is known, and the
 * STAND where the airport gives one that is not the gate itself (a remote
 * stand: "B4 · T1 · Stand 512"). A contact stand named like its gate is the
 * gate said twice.
 */
export function gateLabel(gate: string, terminal: string, stand = ""): string {
  return [gate, terminal && `T${terminal.replace(/^T/i, "")}`, stand && stand !== gate && `Stand ${stand}`]
    .filter(Boolean)
    .join(" · ")
}
