import { findByProps } from "@vendetta/metro";
import { ReactNative } from "@vendetta/metro/common";
import { showCustomAlert } from "@vendetta/ui/alerts";
import { Alert, Codeblock, Forms } from "@vendetta/ui/components";

const Alerts = findByProps("openLazy", "close");
const styles = ReactNative.StyleSheet.create({
  container: {
    maxHeight: 420,
  },
  entry: {
    paddingVertical: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 4,
  },
  timestamp: {
    opacity: 0.7,
    marginBottom: 8,
  },
});

function formatTimestamp(timestamp: any) {
  const date = new Date(timestamp ?? Date.now());
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function formatContent(content: any) {
  return typeof content === "string" && content.length ? content : "(empty message)";
}

function buildEntries(message: any) {
  const edits = Array.isArray(message?.__vml_edits) ? [...message.__vml_edits].reverse() : [];
  return [
    {
      key: "current",
      title: `Version ${edits.length + 1} (Current)`,
      timestamp: message?.edited_timestamp ?? message?.timestamp,
      content: message?.content,
    },
    ...edits.map((edit, index) => ({
      key: `${edit.timestamp ?? index}-${index}`,
      title: `Version ${edits.length - index}`,
      timestamp: edit.timestamp,
      content: edit.content,
    })),
  ];
}

export function openHistoryAlert(message: any) {
  showCustomAlert(EditHistoryAlert, { message });
}

function EditHistoryAlert({ message }: { message: any; }) {
  const entries = buildEntries(message);

  return (
    <Alert
      title="Message Edit History"
      confirmText="Close"
      onConfirm={() => Alerts.close()}
    >
      <ReactNative.ScrollView style={styles.container}>
        {entries.map((entry, index) => (
          <ReactNative.View key={entry.key} style={styles.entry}>
            <Forms.FormText style={styles.title}>{entry.title}</Forms.FormText>
            <Forms.FormText style={styles.timestamp}>{formatTimestamp(entry.timestamp)}</Forms.FormText>
            <Codeblock selectable>{formatContent(entry.content)}</Codeblock>
            {index !== entries.length - 1 && <Forms.FormDivider />}
          </ReactNative.View>
        ))}
      </ReactNative.ScrollView>
    </Alert>
  );
}
