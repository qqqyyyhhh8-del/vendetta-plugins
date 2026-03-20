import { findAll, findByName, findByProps } from "@vendetta/metro";
import { FluxDispatcher, ReactNative } from "@vendetta/metro/common";
import { after, before, instead } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { getAssetIDByName } from "@vendetta/ui/assets";
import { Forms } from "@vendetta/ui/components";
import { findInReactTree } from "@vendetta/utils";

import { openHistoryAlert } from "./history";

const patches: Array<() => void> = [];
const patchedActionSheets = new WeakSet<object>();
const ChannelMessages = findByProps("_channelMessages");
const MessageRecordUtils = findByProps("updateMessageRecord", "createMessageRecord");
const MessageRecord = findByName("MessageRecord", false);
const RowManager = findByName("RowManager");
const ActionSheet = findByProps("openLazy", "hideActionSheet");
const { FormRow } = Forms;
const MAX_EDIT_HISTORY = 50;

storage.logEdits ??= true;
storage.nopk ??= false;

function cloneEdits(message: any) {
  return Array.isArray(message?.__vml_edits) ? message.__vml_edits.map((edit: any) => ({ ...edit })) : [];
}

function getMessageContent(message: any) {
  return typeof message?.content === "string" ? message.content : "";
}

function appendEdit(message: any, editedMessage: any) {
  return [
    ...cloneEdits(message),
    {
      content: getMessageContent(message),
      timestamp: editedMessage.edited_timestamp ?? new Date().toISOString(),
    },
  ].slice(-MAX_EDIT_HISTORY);
}

function mergeMessageState(message: any, updatedMessage: any) {
  if (!updatedMessage) return updatedMessage;

  const hasHistory = !!message?.__vml_deleted || Array.isArray(message?.__vml_edits);
  const contentChanged = storage.logEdits
    && !!updatedMessage.edited_timestamp
    && getMessageContent(updatedMessage) !== getMessageContent(message);

  if (!hasHistory && !contentChanged) {
    return updatedMessage;
  }

  return {
    ...updatedMessage,
    __vml_deleted: updatedMessage.__vml_deleted ?? !!message?.__vml_deleted,
    __vml_edits: contentChanged ? appendEdit(message, updatedMessage) : cloneEdits(message),
  };
}

function patchMessageActionSheet(actionSheet: any) {
  if (!actionSheet || patchedActionSheets.has(actionSheet) || typeof actionSheet.default !== "function") return;

  const name = actionSheet.default.displayName ?? actionSheet.default.name ?? "";
  if (!/LongPressActionSheet/.test(name)) return;

  patchedActionSheets.add(actionSheet);
  patches.push(after("default", actionSheet, ([props], res) => {
    const message = props?.message;
    if (!message?.__vml_edits?.length) return;

    const actions = findInReactTree(res, (tree) => tree?.[0]?.key);
    if (!actions?.length || actions.some((section: any) => section?.key === "vml-edit-history")) return;

    const ActionsSection = actions[0]?.type;
    if (typeof ActionsSection !== "function") return;

    actions.unshift(
      <ActionsSection key="vml-edit-history">
        <FormRow
          label={`View Edit History (${message.__vml_edits.length})`}
          leading={<FormRow.Icon source={getAssetIDByName("ic_audit_log_24px")} />}
          onPress={() => {
            ActionSheet.hideActionSheet();
            setTimeout(() => openHistoryAlert(message), 0);
          }}
        />
      </ActionsSection>,
    );
  }));
}

function patchMessageActionSheets() {
  findAll((module) => typeof module?.default === "function" && /LongPressActionSheet/.test(module.default.displayName ?? module.default.name ?? ""))
    .forEach(patchMessageActionSheet);

  patches.push(before("openLazy", ActionSheet, ([component]) => {
    component?.then?.((instance: any) => patchMessageActionSheet(instance));
  }));
}

patches.push(before("dispatch", FluxDispatcher, ([event]) => {
  if (event.type === "MESSAGE_DELETE") {
    if (event.__vml_cleanup) return event;

    const channel = ChannelMessages.get(event.channelId);
    const message = channel?.get(event.id);
    if (!message) return event;

    if (message.author?.id == "1") return event;
    if (message.state == "SEND_FAILED") return event;

    storage.nopk && fetch(`https://api.pluralkit.me/v2/messages/${encodeURIComponent(message.id)}`)
      .then((res) => res.json())
      .then((data) => {
        if (message.id === data.original && !data.member?.keep_proxy) {
          FluxDispatcher.dispatch({
            type: "MESSAGE_DELETE",
            id: message.id,
            channelId: message.channel_id,
            __vml_cleanup: true,
          });
        }
      });

    return [{
      message: {
        ...message.toJS(),
        __vml_deleted: true,
        __vml_edits: cloneEdits(message),
      },
      type: "MESSAGE_UPDATE",
    }];
  }

  if (event.type === "MESSAGE_UPDATE" && event.message?.id) {
    const channel = ChannelMessages.get(event.message.channel_id ?? event.channelId);
    const message = channel?.get(event.message.id);
    if (!message) return event;

    if (message.author?.id == "1") return event;
    if (message.state == "SEND_FAILED") return event;

    const mergedMessage = mergeMessageState(message, event.message);
    if (mergedMessage === event.message) return event;

    return [{
      ...event,
      message: mergedMessage,
    }];
  }
}));

patches.push(after("generate", RowManager.prototype, ([data], row) => {
  if (data.rowType !== 1) return;
  if (data.message.__vml_deleted) {
    row.message.edited = "deleted";
    row.backgroundHighlight ??= {};
    row.backgroundHighlight.backgroundColor = ReactNative.processColor("#da373c22");
    row.backgroundHighlight.gutterColor = ReactNative.processColor("#da373cff");
  }
}));

patches.push(instead("updateMessageRecord", MessageRecordUtils, function ([oldRecord, newRecord], orig) {
  if (newRecord.__vml_deleted) {
    return MessageRecordUtils.createMessageRecord(newRecord, oldRecord.reactions);
  }
  return orig.apply(this, [oldRecord, newRecord]);
}));

patches.push(after("createMessageRecord", MessageRecordUtils, function ([message], record) {
  record.__vml_deleted = message.__vml_deleted;
  record.__vml_edits = cloneEdits(message);
}));

patches.push(after("default", MessageRecord, ([props], record) => {
  record.__vml_deleted = !!props.__vml_deleted;
  record.__vml_edits = cloneEdits(props);
}));

patchMessageActionSheets();

export const onUnload = () => {
  patches.forEach((unpatch) => unpatch());

  for (const channelId in ChannelMessages._channelMessages) {
    for (const message of ChannelMessages._channelMessages[channelId]._array) {
      message.__vml_deleted && FluxDispatcher.dispatch({
        type: "MESSAGE_DELETE",
        id: message.id,
        channelId: message.channel_id,
        __vml_cleanup: true,
      });
    }
  }
};

export { default as settings } from "./settings";
