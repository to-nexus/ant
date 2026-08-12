/**
 * When may the config panel overwrite the live selection with slot defaults?
 *
 * The panel's seeding effect used to run on every MOUNT, so any selection made
 * elsewhere was destroyed by simply arriving at the panel: `ActionsPanel`
 * unmounts the view for the `basis-edit` step, so basis wizard → back wiped it,
 * and so did picking context in the chat composer before opening the tab.
 *
 * Intent-change reset is already owned by `uiSlice.updateActionMetadata`
 * (`patch.intent !== s.actionMetadata.intent` clears refs/context/target), so
 * the panel only needs to seed when the store has not been seeded for the
 * intent being shown — i.e. a genuine intent switch, or an untouched selection.
 */
export function shouldSeedSlotDefaults(args: {
  /** `actionMetadata.intent` — what the store is currently seeded for. */
  metaIntent: string | undefined;
  /** The intent this panel instance renders. */
  viewIntent: string;
  /** Whether the user has any refs/context selected right now. */
  hasSelection: boolean;
}): boolean {
  if (args.metaIntent !== args.viewIntent) return true;
  return !args.hasSelection;
}
