// The electrical solver (task 1.2): a lumped model of the power graph, solved once per tick. Internal to
// sim-core, like the graph: the tick loop imports it by relative path. See packages/sim-core/docs/electrical.md.

export { initialElectricalState, electricalModel, solveElectrical, stepElectrical } from './solve.ts';
export { KNEE_VOLTS, LEAK_SIEMENS, OUTPUT_OHMS, SETTLE_VOLTS } from './circuit.ts';
export { CHARGE_BAND, REVERSED_VOLTS, voltageWay } from './needs.ts';
export { batteryEmf, positionActuatorMilliamps, settingValue, speedActuatorModel, speedSettings } from './primitives.ts';
export type { SpeedActuatorModel } from './primitives.ts';
export type {
  ActuatorState,
  ElectricalInputs,
  ElectricalModel,
  ElectricalSolution,
  ElectricalState,
  ElectricalTick,
  ElectricalVerdict,
  ExplainedNeed,
  PartFlow,
  PortFlow,
  ShortCircuit,
  SourceFlow,
  UseFlow,
  VoltageWay,
} from './types.ts';
