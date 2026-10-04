// The adult account and child profiles (task 5.1). See ../../README.md, "Accounts and the profile switch".
export { answers, gateQuestion } from './gate.ts';
export type { GateQuestion } from './gate.ts';
export { ChoiceNotKept, NAME_MAX, NameRefused, ShareRefused, addChild, nameOf, readAccounts, removeChild, renameChild, shareLinkFor, switchChild } from './model.ts';
export type { Accounts } from './model.ts';
export { mountParentWith } from './mount.tsx';
export type { ParentOptions } from './mount.tsx';
export { PARENT_TEXT, ParentView } from './view.tsx';
export { PARENT_ACCESS_CSS, PARENT_ROOT, ParentAccess, accessAttributes, applyAccess } from './access.tsx';
export type { AccessAttributes, Hand, ParentAccessProps } from './access.tsx';
