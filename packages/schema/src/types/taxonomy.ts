/**
 * The part families, in catalogue order (brief Section 3). The brief names ten of eleven; the
 * eleventh waits on decision D4. Adding it is one entry here plus a minor bump of SCHEMA_VERSION:
 * the `PartFamily` type and every validator read this list.
 */
export const PART_FAMILIES = [
  { id: 'power', label: 'Power' },
  { id: 'brain', label: 'Brain' },
  { id: 'sense', label: 'Sense' },
  { id: 'actuators', label: 'Actuators' },
  { id: 'drivetrain', label: 'Drivetrain' },
  { id: 'structure-and-ride', label: 'Structure & Ride' },
  { id: 'output', label: 'Output' },
  { id: 'comms', label: 'Comms' },
  { id: 'connection', label: 'Connection' },
  { id: 'end-effectors', label: 'End Effectors' },
] as const;

export type PartFamily = (typeof PART_FAMILIES)[number]['id'];

/** The five curriculum domains (brief Section 3). Every part belongs to at least one. */
export const DOMAINS = [
  { id: 'mechanics', label: 'Mechanics' },
  { id: 'robotic-system-components', label: 'Robotic system components' },
  { id: 'electronics-and-power', label: 'Electronics and power' },
  { id: 'sensing-and-feedback-loops', label: 'Sensing and feedback loops' },
  { id: 'programs-and-computing', label: 'Programs and computing' },
] as const;

export type Domain = (typeof DOMAINS)[number]['id'];
