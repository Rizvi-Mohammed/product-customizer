declare module "@shopify/app-bridge/actions" {
  import type { ClientApplication } from "@shopify/app-bridge";

  export enum ResourceType {
    Product = "product",
    Collection = "collection",
    File = "file",
  }

  export namespace Picker {
    export enum ActionVerb {
      Select = "SELECT",
    }
    export enum Action {
      SELECT = "SELECT",
      OPEN = "OPEN",
    }
    export type PickerPayload = { selection?: any[] };
  }

  export interface PickerCreateOptions {
    resourceType: ResourceType;
    actionVerb: Picker.ActionVerb;
    multiple?: boolean;
  }

  export interface PickerInstance {
    dispatch: (action: Picker.Action) => void;
    subscribe: (
      action: Picker.Action,
      callback: (payload: Picker.PickerPayload) => void,
    ) => void;
  }

  export function create(app: ClientApplication<any>, opts: PickerCreateOptions): PickerInstance;
  export { create as PickerCreate };
  export { Picker };
}
