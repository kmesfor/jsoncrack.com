import React, { useState, useEffect } from "react";
import type { ModalProps } from "@mantine/core";
import {
  Modal,
  Stack,
  Text,
  ScrollArea,
  Flex,
  CloseButton,
  Button,
  Textarea,
  Group,
  Drawer,
} from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import useFile from "../../../store/useFile";
import useJson from "../../../store/useJson";
// added import
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";

// added import (update path stays inside src)

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj: Record<string, any> = {}; // typed to avoid index signature errors
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key as string] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

// helper: safely parse global json string
const getRootJson = () => {
  const s = useJson.getState().json ?? "{}";
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

// helper: get value at path (array of keys/indices) from root object
const getValueAtPath = (root: any, path?: Array<string | number>) => {
  if (!path || path.length === 0) return root;
  let cur = root;
  for (let i = 0; i < path.length; i++) {
    if (cur == null) return undefined;
    const seg = path[i];
    cur = cur[seg as any];
  }
  return cur;
};

export const NodeModal = (props: ModalProps) => {
  const { opened, onClose } = props;
  const nodeData = useGraph((state: any) => state.selectedNode);

  // Edited text buffer and validation state (used by the right-side Drawer)
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editedText, setEditedText] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Attempt to get possible update/setter functions from the graph store.
  // Try multiple names so this works regardless of exact store API.
  const updateFn: ((...args: any[]) => any) | null = useGraph(
    (state: any) =>
      state.updateNode ?? state.updateSelectedNode ?? state.setNodeData ?? state.replaceNode ?? null
  );
  const setSelectedNode: ((node: any) => any) | null = useGraph(
    (state: any) => state.setSelectedNode ?? state.setNode ?? null
  );

  // Reset editor state when selected node changes or when modal closes
  useEffect(() => {
    // Keep preview unchanged in the center modal; only initialize edit buffer when edit drawer opens.
    if (!isEditOpen) {
      setError(null);
      setEditedText("");
    }
  }, [nodeData, isEditOpen]);

  // Initialize editedText each time the drawer opens
  useEffect(() => {
    if (isEditOpen) {
      const root = getRootJson();
      const value = getValueAtPath(root, nodeData?.path as Array<string | number> | undefined);
      // show full object/primitive JSON for editing
      setEditedText(value === undefined ? "{}" : JSON.stringify(value, null, 2));
      setError(null);
    }
  }, [isEditOpen, nodeData]);

  // helper: set a value at path (array of keys/indices) on a plain JS object/array
  const setAtPath = (root: any, path: Array<string | number>, value: any) => {
    if (!path || path.length === 0) return value;
    const res = root === undefined || root === null ? {} : root;
    let cur: any = res;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      const isLast = i === path.length - 1;
      if (isLast) {
        cur[seg as any] = value;
      } else {
        if (cur[seg as any] === undefined || cur[seg as any] === null) {
          // create array or object depending on next segment type
          cur[seg as any] = typeof path[i + 1] === "number" ? [] : {};
        }
        cur = cur[seg as any];
      }
    }
    return res;
  };

  const handleSave = () => {
    try {
      const parsed = JSON.parse(editedText);

      // Merge the edited value into the full JSON at the node path instead of replacing whole json.
      const currentJsonStr = useJson.getState().json ?? "{}";
      let rootObj: any = {};
      try {
        rootObj = JSON.parse(currentJsonStr);
      } catch {
        rootObj = {};
      }

      if (!nodeData?.path || nodeData.path.length === 0) {
        // replace root
        rootObj = parsed;
      } else {
        // mutate a copy to be safe
        const copy = Array.isArray(rootObj) ? [...rootObj] : { ...rootObj };
        setAtPath(copy, nodeData.path as Array<string | number>, parsed);
        rootObj = copy;
      }

      // update canonical json store
      const jsonStr = JSON.stringify(rootObj);
      useJson.setState({ json: jsonStr });

      // also update the sidebar editor contents (pretty-printed) so Monaco shows latest JSON
      const pretty = JSON.stringify(rootObj, null, 2);
      // call the file store setter so the TextEditor reflects the change
      try {
        useFile.getState().setContents?.({ contents: pretty, skipUpdate: false });
      } catch {
        // fallback: if setContents isn't available, try setState
        useFile.setState?.({ contents: pretty });
      }

      // Rebuild the graph from the updated json so Canvas reflects changes
      useGraph.getState().setGraph();

      // Update selectedNode in-store so the centered preview updates immediately.
      if (setSelectedNode) {
        setSelectedNode({
          ...nodeData,
          text: [{ value: editedText }],
        });
      }

      setIsEditOpen(false);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? "Invalid JSON");
    }
  };

  const handleCancel = () => {
    // reset editor to full JSON at path
    const root = getRootJson();
    const value = getValueAtPath(root, nodeData?.path as Array<string | number> | undefined);
    setEditedText(value === undefined ? "{}" : JSON.stringify(value, null, 2));
    setError(null);
    setIsEditOpen(false);
  };

  return (
    <>
      <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
        <Stack pb="sm" gap="sm">
          <Stack gap="xs">
            <Flex justify="space-between" align="center">
              <Text fz="xs" fw={500}>
                Content
              </Text>
              <Group gap="xs">
                <Button size="xs" variant="outline" onClick={() => setIsEditOpen(true)}>
                  Edit
                </Button>
                <CloseButton onClick={onClose} />
              </Group>
            </Flex>

            <ScrollArea.Autosize mah={250} maw={600}>
              {/* Show full JSON value at node path (all properties) in preview */}
              <CodeHighlight
                code={(() => {
                  const root = getRootJson();
                  const value = getValueAtPath(
                    root,
                    nodeData?.path as Array<string | number> | undefined
                  );
                  if (value === undefined) {
                    // fallback to previous normalized view if path missing
                    return normalizeNodeData(nodeData?.text ?? []);
                  }
                  return JSON.stringify(value, null, 2);
                })()}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            </ScrollArea.Autosize>
          </Stack>

          <Text fz="xs" fw={500}>
            JSON Path
          </Text>
          <ScrollArea.Autosize maw={600}>
            <CodeHighlight
              code={jsonPathToString(nodeData?.path)}
              miw={350}
              mah={250}
              language="json"
              copyLabel="Copy to clipboard"
              copiedLabel="Copied to clipboard"
              withCopyButton
            />
          </ScrollArea.Autosize>
        </Stack>
      </Modal>

      {/* Right-side editor drawer */}
      <Drawer
        opened={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        position="right"
        size={540}
        padding="md"
        title="Edit Content"
        closeOnClickOutside={false}
      >
        <Stack>
          <Textarea
            value={editedText}
            onChange={e => setEditedText(e.currentTarget.value)}
            minRows={10}
            autosize
          />
          {error && (
            <Text fz="xs" color="red" mt="xs">
              {error}
            </Text>
          )}
          <Group>
            <Button size="xs" onClick={handleSave}>
              Save
            </Button>
            <Button size="xs" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          </Group>
        </Stack>
      </Drawer>
    </>
  );
};
