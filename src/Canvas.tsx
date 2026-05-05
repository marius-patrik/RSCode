import "@xyflow/react/dist/style.css";

import { type ActionGroup, ActionsMenu } from "@/ActionsMenu.tsx";
import { Breadcrumb } from "@/Breadcrumb.tsx";
import { MonacoEditor, languageForFile } from "@/MonacoEditor.tsx";
import { TerminalNodeView } from "@/TerminalNode.tsx";
import { Toolbar } from "@/Toolbar.tsx";
import { type CommandDefinition, commandGroupsFor, disabled, enabled } from "@/commands.ts";
import {
  DEFAULT_FOLDER_LIMIT,
  TREE_NODE_HEIGHT,
  extractMorePath,
  extractTreePath,
  layoutVisibleTree,
} from "@/layout.ts";
import {
  type CanvasGraph,
  type CanvasSession,
  type EditorPanelState,
  type FinderResult,
  GRAPH_NODE_DEFINITIONS,
  type GraphEdge,
  type GraphExecutionResult,
  type GraphExecutionStep,
  type GraphIssue,
  type GraphNode,
  type GraphNodeConfig,
  type GraphNodeKind,
  type PanelState,
} from "@/schema.ts";
import { cn } from "@/utils.ts";
import {
  Background,
  BackgroundVariant,
  type Connection,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Code2,
  FileText,
  Folder,
  Maximize2,
  PanelTopClose,
  Play,
  Search,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type FsEntry = { kind: "dir" | "file"; name: string; path: string };

type CanvasProps = {
  session: CanvasSession;
  fileTrees: Map<string, FsEntry[]>;
  graphIssues: GraphIssue[];
  lastRun: GraphExecutionResult | null;
  onSessionChange: (session: CanvasSession) => void;
  onCommandGroupsChange: (groups: ActionGroup[]) => void;
  onRequestTree: (path: string) => void;
  onReadFile: (path: string) => Promise<string>;
  onWriteFile: (path: string, body: string) => Promise<void>;
  onMkdir: (path: string) => Promise<void>;
  onCreateFile: (path: string, kind: "markdown" | "json" | "yaml" | "typescript" | "plain") => Promise<void>;
  onDeleteEntry: (path: string) => Promise<void>;
  onExecuteGraph: (nodeId?: string) => Promise<void>;
};

type FolderNodeData = {
  name: string;
  path: string;
  childCount: number | null;
  expanded: boolean;
  onToggle: () => void;
  onDrill: () => void;
};
type FolderFlowNode = Node<FolderNodeData, "folderNode">;

type FileNodeData = {
  name: string;
  path: string;
  ext: string;
  onOpen: () => void;
};
type FileFlowNode = Node<FileNodeData, "fileNode">;

type MoreNodeData = {
  parentPath: string;
  shown: number;
  hidden: number;
  onLoadMore: () => void;
};
type MoreFlowNode = Node<MoreNodeData, "moreNode">;

type GraphActionNodeData = {
  node: GraphNode;
  issues: GraphIssue[];
  lastStep: GraphExecutionStep | null;
  onConfigChange: (patch: Partial<GraphNodeConfig>) => void;
};
type GraphActionFlowNode = Node<GraphActionNodeData, "graphActionNode">;

type FlowNode = FolderFlowNode | FileFlowNode | MoreFlowNode | GraphActionFlowNode;

const NODE_TYPES = {
  folderNode: FolderNodeComponent,
  fileNode: FileNodeComponent,
  moreNode: MoreNodeComponent,
  graphActionNode: GraphActionNodeComponent,
};

const GRAPH_LANE_Y = 420;
const PANEL_MIN_WIDTH = 420;
const PANEL_MIN_HEIGHT = 260;

type ModalRequest =
  | {
      kind: "prompt";
      title: string;
      message: string;
      defaultValue: string;
      confirmLabel: string;
      onSubmit: (value: string) => void;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmLabel: string;
      destructive?: boolean;
      onConfirm: () => void;
    };

export function Canvas({
  session,
  fileTrees,
  graphIssues,
  lastRun,
  onSessionChange,
  onCommandGroupsChange,
  onRequestTree,
  onReadFile,
  onWriteFile,
  onMkdir,
  onCreateFile,
  onDeleteEntry,
  onExecuteGraph,
}: CanvasProps) {
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [folderLimits, setFolderLimits] = useState<Map<string, number>>(() => new Map());
  const [finderOpen, setFinderOpen] = useState(false);
  const [finderQuery, setFinderQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalRequest | null>(null);
  const reactFlowInstance = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);

  const expandedPaths = useMemo(() => new Set(session.expandedPaths), [session.expandedPaths]);
  const selectedTreePath = selectedNodeId ? extractTreePath(selectedNodeId) : null;
  const selectedGraphNodeId = selectedNodeId?.startsWith("graph-") ? selectedNodeId : null;
  const selectedEntry = selectedTreePath ? findEntry(fileTrees, selectedTreePath) : null;
  const activePanel = session.openPanels.find((panel) => panel.id === activePanelId) ?? null;

  const commitSession = useCallback(
    (next: CanvasSession) => {
      onSessionChange({ ...next, updatedAt: nowIso() });
    },
    [onSessionChange],
  );

  const updateSession = useCallback(
    (patch: Partial<CanvasSession>) => {
      commitSession({ ...session, ...patch });
    },
    [commitSession, session],
  );

  useEffect(() => {
    if (!fileTrees.has(session.address)) onRequestTree(session.address);
    for (const path of session.expandedPaths) {
      if (!fileTrees.has(path)) onRequestTree(path);
    }
  }, [fileTrees, onRequestTree, session.address, session.expandedPaths]);

  useEffect(() => {
    setActivePanelId((current) => current ?? session.openPanels.at(-1)?.id ?? null);
    setSelectedNodeId(null);
    setFolderLimits(new Map());
    setFinderOpen(false);
  }, [session.openPanels]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3_000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const inst = reactFlowInstance.current;
    if (!inst) return;
    inst.setViewport(session.viewport, { duration: 150 });
  }, [session.viewport]);

  const commitGraph = useCallback(
    (graph: CanvasGraph) => {
      updateSession({ graph: { ...graph, updatedAt: nowIso() } });
    },
    [updateSession],
  );

  const focusNode = useCallback((id: string) => {
    const inst = reactFlowInstance.current;
    if (!inst) return;
    inst.fitView({ nodes: [{ id }], duration: 300, padding: 0.35, maxZoom: 1.2 });
    setSelectedNodeId(id);
  }, []);

  const focusPanel = useCallback(
    (panelId: string) => {
      const topZ = maxPanelZ(session.openPanels) + 1;
      updateSession({
        openPanels: session.openPanels.map((panel) =>
          panel.id === panelId ? { ...panel, z: topZ, updatedAt: nowIso() } : panel,
        ),
      });
      setActivePanelId(panelId);
    },
    [session.openPanels, updateSession],
  );

  const openFilePanel = useCallback(
    async (path: string) => {
      const existing = session.openPanels.find((panel) => panel.kind === "editor" && panel.path === path);
      if (existing) {
        focusPanel(existing.id);
        return;
      }
      try {
        const body = await onReadFile(path);
        const panel = makeEditorPanel(path, body, session.openPanels);
        updateSession({ openPanels: [...session.openPanels, panel] });
        setActivePanelId(panel.id);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    },
    [focusPanel, onReadFile, session.openPanels, updateSession],
  );

  const openTerminalPanel = useCallback(
    (cwd: string) => {
      const existing = session.openPanels.find((panel) => panel.kind === "terminal" && panel.cwd === cwd);
      if (existing) {
        focusPanel(existing.id);
        return;
      }
      const panel = makeTerminalPanel(cwd, session.openPanels);
      updateSession({ openPanels: [...session.openPanels, panel] });
      setActivePanelId(panel.id);
    },
    [focusPanel, session.openPanels, updateSession],
  );

  const updatePanel = useCallback(
    (panelId: string, patch: Partial<PanelState>) => {
      updateSession({
        openPanels: session.openPanels.map((panel) =>
          panel.id === panelId ? ({ ...panel, ...patch, updatedAt: nowIso() } as PanelState) : panel,
        ),
      });
    },
    [session.openPanels, updateSession],
  );

  const closePanel = useCallback(
    (panelId: string) => {
      const nextPanels = session.openPanels.filter((panel) => panel.id !== panelId);
      updateSession({ openPanels: nextPanels });
      setActivePanelId((current) =>
        current === panelId ? (nextPanels.toSorted((a, b) => b.z - a.z)[0]?.id ?? null) : current,
      );
    },
    [session.openPanels, updateSession],
  );

  const saveEditorPanel = useCallback(
    async (panel: EditorPanelState) => {
      await onWriteFile(panel.path, panel.draftBody);
      updatePanel(panel.id, { dirty: false } as Partial<PanelState>);
      setNotice(`saved ${panel.path}`);
    },
    [onWriteFile, updatePanel],
  );

  const addGraphNode = useCallback(
    (kind: GraphNodeKind) => {
      const center =
        reactFlowInstance.current?.screenToFlowPosition({
          x: Math.round(window.innerWidth / 2),
          y: Math.round(window.innerHeight / 2),
        }) ?? { x: 120 + session.graph.nodes.length * 28, y: GRAPH_LANE_Y };
      const id = `graph-${kind.replace(".", "-")}-${Date.now().toString(36)}`;
      const node: GraphNode = {
        id,
        kind,
        position: {
          x: center.x,
          y: Math.max(center.y, GRAPH_LANE_Y),
        },
        config: defaultConfigFor(kind, session.address),
      };
      commitGraph({ ...session.graph, nodes: [...session.graph.nodes, node] });
      setSelectedNodeId(id);
      setNotice(`${GRAPH_NODE_DEFINITIONS[kind].label} added`);
    },
    [commitGraph, session.address, session.graph],
  );

  const deleteGraphNode = useCallback(
    (nodeId: string) => {
      commitGraph({
        ...session.graph,
        nodes: session.graph.nodes.filter((node) => node.id !== nodeId),
        edges: session.graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
      });
      setSelectedNodeId(null);
    },
    [commitGraph, session.graph],
  );

  const updateGraphNodeConfig = useCallback(
    (nodeId: string, patch: Partial<GraphNodeConfig>) => {
      commitGraph({
        ...session.graph,
        nodes: session.graph.nodes.map((node) =>
          node.id === nodeId ? { ...node, config: { ...node.config, ...patch } } : node,
        ),
      });
    },
    [commitGraph, session.graph],
  );

  const updateGraphNodePosition = useCallback(
    (nodeId: string, position: { x: number; y: number }) => {
      commitGraph({
        ...session.graph,
        nodes: session.graph.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
      });
    },
    [commitGraph, session.graph],
  );

  const treeLayout = useMemo(
    () =>
      layoutVisibleTree({
        address: session.address,
        fileTrees,
        expandedPaths,
        folderLimits,
      }),
    [expandedPaths, fileTrees, folderLimits, session.address],
  );

  const { nodes, edges } = useMemo(() => {
    const flowNodes: FlowNode[] = [];
    const flowEdges: Edge[] = [];

    for (const layoutNode of treeLayout.nodes) {
      if (layoutNode.type === "more") {
        flowNodes.push({
          id: layoutNode.id,
          type: "moreNode",
          position: layoutNode.position,
          draggable: false,
          data: {
            parentPath: layoutNode.parentPath,
            shown: layoutNode.shown,
            hidden: layoutNode.hidden,
            onLoadMore: () => {
              setFolderLimits((prev) => {
                const next = new Map(prev);
                next.set(layoutNode.parentPath, layoutNode.shown + DEFAULT_FOLDER_LIMIT);
                return next;
              });
            },
          },
        });
        continue;
      }

      const entry = layoutNode.entry;
      if (entry.kind === "dir") {
        flowNodes.push({
          id: layoutNode.id,
          type: "folderNode",
          position: layoutNode.position,
          draggable: false,
          data: {
            name: entry.name,
            path: entry.path,
            childCount: layoutNode.childCount,
            expanded: layoutNode.expanded,
            onToggle: () => toggleExpandedPath(entry.path),
            onDrill: () => {
              updateSession({ address: entry.path, expandedPaths: [] });
              setSelectedNodeId(null);
            },
          },
        });
      } else {
        flowNodes.push({
          id: layoutNode.id,
          type: "fileNode",
          position: layoutNode.position,
          draggable: false,
          data: {
            name: entry.name,
            path: entry.path,
            ext: entry.name.split(".").pop() ?? "",
            onOpen: () => void openFilePanel(entry.path),
          },
        });
      }
    }

    for (const edge of treeLayout.edges) {
      flowEdges.push(treeEdge(edge.source, edge.target));
    }

    const runSteps = new Map((lastRun?.steps ?? []).map((step) => [step.nodeId, step]));
    for (const graphNode of session.graph.nodes) {
      flowNodes.push({
        id: graphNode.id,
        type: "graphActionNode",
        position: graphNode.position,
        draggable: true,
        data: {
          node: graphNode,
          issues: graphIssues.filter((issue) => issue.nodeId === graphNode.id),
          lastStep: runSteps.get(graphNode.id) ?? null,
          onConfigChange: (patch) => updateGraphNodeConfig(graphNode.id, patch),
        },
      });
    }

    return {
      nodes: flowNodes,
      edges: [...flowEdges, ...session.graph.edges.map((edge) => graphEdgeToFlow(edge, graphIssues))],
    };

    function toggleExpandedPath(path: string) {
      const next = new Set(expandedPaths);
      if (next.has(path)) {
        for (const existing of Array.from(next)) {
          if (existing === path || existing.startsWith(`${path}/`)) next.delete(existing);
        }
      } else {
        next.add(path);
      }
      updateSession({ expandedPaths: Array.from(next) });
    }
  }, [
    expandedPaths,
    graphIssues,
    lastRun,
    openFilePanel,
    session.graph.edges,
    session.graph.nodes,
    treeLayout.edges,
    treeLayout.nodes,
    updateGraphNodeConfig,
    updateSession,
  ]);

  const commands = useMemo(
    () =>
      createCanvasCommands({
        address: session.address,
        selectedEntry,
        selectedGraphNodeId,
        activePanel,
        openFilePanel,
        openTerminalPanel,
        closePanel,
        saveEditorPanel,
        setFinderOpen,
        focusSelected: () => {
          if (selectedNodeId) focusNode(selectedNodeId);
          else reactFlowInstance.current?.fitView({ duration: 300, padding: 0.16, maxZoom: 1 });
        },
        fitView: () => reactFlowInstance.current?.fitView({ duration: 300, padding: 0.16, maxZoom: 1 }),
        refresh: () => {
          onRequestTree(session.address);
          reactFlowInstance.current?.fitView({ duration: 300, padding: 0.16, maxZoom: 1 });
        },
        mkdir: (parentPath) => {
          setModal({
            kind: "prompt",
            title: "New Folder",
            message: parentPath,
            defaultValue: "new-folder",
            confirmLabel: "Create",
            onSubmit: (name) => {
              const child = joinPath(parentPath, name);
              void onMkdir(child).then(() => onRequestTree(parentPath));
            },
          });
        },
        createFile: (parentPath, kind) => {
          const ext = extensionForKind(kind);
          setModal({
            kind: "prompt",
            title: `New ${kind} file`,
            message: parentPath,
            defaultValue: `untitled.${ext}`,
            confirmLabel: "Create",
            onSubmit: (name) => {
              const child = joinPath(parentPath, name);
              void onCreateFile(child, kind).then(() => {
                onRequestTree(parentPath);
                void openFilePanel(child);
              });
            },
          });
        },
        deleteEntry: (path) => {
          setModal({
            kind: "confirm",
            title: "Delete Entry",
            message: path,
            confirmLabel: "Delete",
            destructive: true,
            onConfirm: () => {
              void onDeleteEntry(path).then(() => onRequestTree(parentPath(path)));
            },
          });
        },
        addGraphNode,
        deleteGraphNode,
        runGraph: () => void onExecuteGraph(),
        runGraphNode: (nodeId) => void onExecuteGraph(nodeId),
      }),
    [
      activePanel,
      addGraphNode,
      closePanel,
      deleteGraphNode,
      focusNode,
      onCreateFile,
      onDeleteEntry,
      onExecuteGraph,
      onMkdir,
      onRequestTree,
      openFilePanel,
      openTerminalPanel,
      saveEditorPanel,
      selectedEntry,
      selectedGraphNodeId,
      selectedNodeId,
      session.address,
    ],
  );

  const commandGroups = useMemo(() => commandGroupsFor(commands), [commands]);

  useEffect(() => {
    onCommandGroupsChange(commandGroups);
  }, [commandGroups, onCommandGroupsChange]);

  const finderResults = useMemo(
    () =>
      buildFinderResults({
        query: finderQuery,
        session,
        fileTrees,
        commands,
        visibleNodeIds: nodes.map((node) => node.id),
      }),
    [commands, fileTrees, finderQuery, nodes, session],
  );

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setFinderOpen(true);
      } else if (e.key === "f" && !e.shiftKey) {
        e.preventDefault();
        reactFlowInstance.current?.fitView({ duration: 300, padding: 0.16, maxZoom: 1 });
      } else if (e.key === "F" || (e.key === "f" && e.shiftKey)) {
        e.preventDefault();
        if (selectedNodeId) focusNode(selectedNodeId);
      } else if (e.key === "r") {
        e.preventDefault();
        onRequestTree(session.address);
      } else if (e.key === "Escape") {
        setFinderOpen(false);
        setMenu(null);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [focusNode, onRequestTree, selectedNodeId, session.address]);

  useEffect(() => {
    if (!menu) return;
    function handlePointer(e: PointerEvent) {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-context-menu]")) return;
      setMenu(null);
    }
    window.addEventListener("pointerdown", handlePointer, true);
    return () => window.removeEventListener("pointerdown", handlePointer, true);
  }, [menu]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      const nextEdge = edgeFromConnection(connection);
      if (!nextEdge) {
        setNotice("drop onto a compatible graph pin");
        return;
      }
      const validation = validateNewEdge(session.graph, nextEdge);
      if (validation) {
        setNotice(validation);
        return;
      }
      commitGraph({ ...session.graph, edges: [...session.graph.edges, nextEdge] });
    },
    [commitGraph, session.graph],
  );

  return (
    <div
      className="relative h-full min-h-0 w-full overflow-hidden bg-[#090d12]"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, nodeId: selectedNodeId ?? undefined });
      }}
    >
      <div className="pointer-events-none absolute left-0 right-0 top-[392px] z-[1] h-[2px] bg-sky-400/20" />
      <div className="pointer-events-none absolute left-6 top-[404px] z-[2] font-mono text-[10px] uppercase tracking-[0.18em] text-sky-100/45">
        executable graph lane
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        defaultViewport={session.viewport}
        proOptions={{ hideAttribution: true }}
        nodesConnectable
        edgesFocusable
        panOnScroll
        zoomOnPinch
        zoomOnScroll={false}
        panOnDrag
        onInit={(inst) => {
          reactFlowInstance.current = inst;
          inst.setViewport(session.viewport, { duration: 0 });
        }}
        onMoveEnd={(_event, viewport) => {
          updateSession({ viewport });
        }}
        onNodeClick={handleNodeClick}
        onSelectionChange={({ nodes: selected }) => {
          setSelectedNodeId(selected[0]?.id ?? null);
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault();
          event.stopPropagation();
          setSelectedNodeId(node.id);
          setMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
        }}
        onNodeDragStop={(_event, node) => {
          if (node.id.startsWith("graph-")) updateGraphNodePosition(node.id, node.position);
        }}
        onConnect={handleConnect}
        onEdgesDelete={(deleted) => {
          const ids = new Set(deleted.map((edge) => edge.id.replace(/^exec:/, "")));
          if (ids.size === 0) return;
          commitGraph({ ...session.graph, edges: session.graph.edges.filter((edge) => !ids.has(edge.id)) });
        }}
        minZoom={0.2}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="rgba(255,255,255,0.14)" />
      </ReactFlow>

      {nodes.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
          <div className="glass-heavy rounded-lg border border-white/10 px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70 backdrop-blur-xl">
            this folder is empty
          </div>
        </div>
      ) : null}

      <Toolbar
        onAction={(action) => {
          if (action === "fit") reactFlowInstance.current?.fitView({ duration: 300, padding: 0.16, maxZoom: 1 });
          if (action === "focusSelected") {
            if (selectedNodeId) focusNode(selectedNodeId);
            else reactFlowInstance.current?.fitView({ duration: 300, padding: 0.16, maxZoom: 1 });
          }
          if (action === "refresh") onRequestTree(session.address);
          if (action === "search") setFinderOpen(true);
        }}
      />
      <Breadcrumb segments={breadcrumbSegments(session.address, (path) => updateSession({ address: path, expandedPaths: [] }))} />

      <PanelManager
        panels={session.openPanels}
        activePanelId={activePanelId}
        onFocus={focusPanel}
        onClose={closePanel}
        onUpdatePanel={updatePanel}
        onSaveEditor={saveEditorPanel}
      />

      <GraphRunInspector
        graph={session.graph}
        issues={graphIssues}
        lastRun={lastRun}
        selectedNodeId={selectedGraphNodeId}
        onRunGraph={() => void onExecuteGraph()}
        onAddNode={addGraphNode}
        onFocusNode={focusNode}
      />

      {finderOpen ? (
        <Finder
          query={finderQuery}
          results={finderResults}
          onQueryChange={setFinderQuery}
          onClose={() => setFinderOpen(false)}
          onPick={(result) => {
            setFinderOpen(false);
            handleFinderPick(result);
          }}
        />
      ) : null}

      {menu ? (
        <ActionsMenu
          x={menu.x}
          y={menu.y}
          title={menuTitleFor(menu.nodeId, session.address)}
          groups={commandGroups}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {notice ? (
        <div className="glass-heavy absolute right-4 top-4 z-50 max-w-md rounded-lg border border-white/10 px-3 py-2 text-sm text-foreground">
          {notice}
        </div>
      ) : null}

      {modal ? <NativeModal request={modal} onClose={() => setModal(null)} /> : null}
    </div>
  );

  function handleNodeClick(event: Parameters<NodeMouseHandler>[0], node: Parameters<NodeMouseHandler>[1]) {
    if (node.id.startsWith("tree:")) {
      const path = extractTreePath(node.id);
      const entry = path ? findEntry(fileTrees, path) : null;
      if (entry?.kind === "dir") {
        const next = new Set(expandedPaths);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        updateSession({ expandedPaths: Array.from(next) });
      } else if (entry?.kind === "file") {
        void openFilePanel(entry.path);
      }
    } else if (node.id.startsWith("more:")) {
      const path = extractMorePath(node.id);
      if (path) {
        setFolderLimits((prev) => {
          const next = new Map(prev);
          next.set(path, (prev.get(path) ?? DEFAULT_FOLDER_LIMIT) + DEFAULT_FOLDER_LIMIT);
          return next;
        });
      }
    }
    event.stopPropagation();
  }

  function handleFinderPick(result: FinderResult) {
    if (result.kind === "command") {
      const command = commands.find((candidate) => candidate.id === result.id.replace(/^command:/, ""));
      command?.run();
      return;
    }
    if (result.kind === "panel") {
      focusPanel(result.id.replace(/^panel:/, ""));
      return;
    }
    if (result.kind === "graph") {
      focusNode(result.id.replace(/^graph-result:/, ""));
      return;
    }
    if (result.kind === "path") {
      updateSession({ address: result.detail ?? result.label, expandedPaths: [] });
      return;
    }
    const nodeId = result.id.replace(/^entry:/, "tree:");
    focusNode(nodeId);
    const path = extractTreePath(nodeId);
    const entry = path ? findEntry(fileTrees, path) : null;
    if (entry?.kind === "file") void openFilePanel(entry.path);
  }
}

function createCanvasCommands(args: {
  address: string;
  selectedEntry: FsEntry | null;
  selectedGraphNodeId: string | null;
  activePanel: PanelState | null;
  openFilePanel: (path: string) => void;
  openTerminalPanel: (cwd: string) => void;
  closePanel: (id: string) => void;
  saveEditorPanel: (panel: EditorPanelState) => void;
  setFinderOpen: (open: boolean) => void;
  focusSelected: () => void;
  fitView: () => void;
  refresh: () => void;
  mkdir: (parentPath: string) => void;
  createFile: (parentPath: string, kind: "markdown" | "json" | "yaml" | "typescript" | "plain") => void;
  deleteEntry: (path: string) => void;
  addGraphNode: (kind: GraphNodeKind) => void;
  deleteGraphNode: (nodeId: string) => void;
  runGraph: () => void;
  runGraphNode: (nodeId: string) => void;
}): CommandDefinition[] {
  const selectedPath = args.selectedEntry?.path ?? null;
  const contextFolder = selectedPath
    ? args.selectedEntry?.kind === "file"
      ? parentPath(selectedPath)
      : selectedPath
    : args.address;
  const activeEditor = args.activePanel?.kind === "editor" ? args.activePanel : null;

  return [
    {
      id: "finder.open",
      label: "Open Finder",
      scope: "navigation",
      group: "navigation",
      hint: "/",
      enabled,
      run: () => args.setFinderOpen(true),
    },
    {
      id: "view.fit",
      label: "Fit Canvas",
      scope: "navigation",
      group: "navigation",
      hint: "f",
      enabled,
      run: args.fitView,
    },
    {
      id: "view.focus-selected",
      label: "Focus Selected",
      scope: "navigation",
      group: "navigation",
      hint: "Shift+f",
      enabled,
      run: args.focusSelected,
    },
    {
      id: "fs.refresh",
      label: "Refresh Folder",
      scope: "filesystem",
      group: "navigation",
      hint: args.address,
      enabled,
      run: args.refresh,
    },
    {
      id: "fs.open-file",
      label: "Open in Editor",
      scope: "filesystem",
      group: "item",
      hint: selectedPath ?? undefined,
      enabled: () => (args.selectedEntry?.kind === "file" ? enabled() : disabled("select a file")),
      run: () => {
        if (selectedPath) args.openFilePanel(selectedPath);
      },
    },
    {
      id: "terminal.open-context",
      label: "Open Terminal Here",
      scope: "filesystem",
      group: "item",
      hint: contextFolder,
      enabled,
      run: () => args.openTerminalPanel(contextFolder),
    },
    {
      id: "fs.delete-entry",
      label: args.selectedEntry?.kind === "dir" ? "Delete Folder" : "Delete File",
      scope: "filesystem",
      group: "item",
      hint: selectedPath ?? undefined,
      destructive: true,
      enabled: () => (selectedPath ? enabled() : disabled("select an item")),
      run: () => {
        if (selectedPath) args.deleteEntry(selectedPath);
      },
    },
    {
      id: "panel.save-active",
      label: "Save Active Editor",
      scope: "panel",
      group: "panel",
      hint: activeEditor?.path,
      enabled: () => (activeEditor ? enabled() : disabled("focus an editor")),
      run: () => {
        if (activeEditor) args.saveEditorPanel(activeEditor);
      },
    },
    {
      id: "panel.close-active",
      label: "Close Active Panel",
      scope: "panel",
      group: "panel",
      hint: args.activePanel?.title,
      enabled: () => (args.activePanel ? enabled() : disabled("focus a panel")),
      run: () => {
        if (args.activePanel) args.closePanel(args.activePanel.id);
      },
    },
    {
      id: "new.folder",
      label: "+ Subfolder",
      scope: "filesystem",
      group: "new",
      hint: contextFolder,
      enabled,
      run: () => args.mkdir(contextFolder),
    },
    ...(["markdown", "json", "yaml", "typescript", "plain"] as const).map((kind) => ({
      id: `new.file.${kind}`,
      label: `+ File: ${kind}`,
      scope: "filesystem" as const,
      group: "new",
      hint: contextFolder,
      enabled,
      run: () => args.createFile(contextFolder, kind),
    })),
    {
      id: "graph.run",
      label: "Run Graph",
      scope: "graph",
      group: "graph",
      enabled,
      run: args.runGraph,
    },
    {
      id: "graph.run-selected",
      label: "Run Selected Graph Node",
      scope: "graph",
      group: "graph",
      hint: args.selectedGraphNodeId ?? undefined,
      enabled: () => (args.selectedGraphNodeId ? enabled() : disabled("select a graph node")),
      run: () => {
        if (args.selectedGraphNodeId) args.runGraphNode(args.selectedGraphNodeId);
      },
    },
    {
      id: "graph.delete-selected",
      label: "Delete Graph Node",
      scope: "graph",
      group: "graph",
      destructive: true,
      enabled: () => (args.selectedGraphNodeId ? enabled() : disabled("select a graph node")),
      run: () => {
        if (args.selectedGraphNodeId) args.deleteGraphNode(args.selectedGraphNodeId);
      },
    },
    ...Object.values(GRAPH_NODE_DEFINITIONS).map((definition) => ({
      id: `graph.add.${definition.kind}`,
      label: `+ ${definition.label} node`,
      scope: "graph" as const,
      group: "graph",
      hint: definition.kind,
      enabled,
      run: () => args.addGraphNode(definition.kind),
    })),
  ];
}

function FolderNodeComponent({ data, selected }: NodeProps<FolderFlowNode>) {
  const Icon = data.expanded ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn(
        "group relative flex w-full cursor-pointer items-center gap-2 rounded-lg border bg-[#0e131a]/90 pl-9 pr-3 py-2 text-left backdrop-blur-md transition-all duration-150",
        "border-violet-400/25 hover:-translate-y-0.5 hover:shadow-[0_0_18px_-6px_rgba(139,92,246,0.55)]",
        selected && "ring-2 ring-white/60 shadow-[0_0_24px_-4px_rgba(139,92,246,0.7)]",
      )}
      style={{ width: 240, minHeight: TREE_NODE_HEIGHT - 22 }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        data.onDrill();
      }}
    >
      <button
        type="button"
        title={data.expanded ? "collapse" : "expand"}
        onClick={(event) => {
          event.stopPropagation();
          data.onToggle();
        }}
        className="absolute left-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-violet-300/80 transition-colors hover:bg-white/[0.10] hover:text-foreground"
      >
        <Icon className="h-4 w-4" />
      </button>
      <Folder className="h-4 w-4 shrink-0 text-violet-300" />
      <span className="truncate text-sm font-semibold text-violet-100/95">{data.name}</span>
      {data.childCount !== null ? (
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground/60">{data.childCount}</span>
      ) : null}
    </div>
  );
}

function FileNodeComponent({ data, selected }: NodeProps<FileFlowNode>) {
  return (
    <button
      type="button"
      title={`open ${data.path}`}
      onClick={(event) => {
        event.stopPropagation();
        data.onOpen();
      }}
      className={cn(
        "relative block rounded-lg border border-white/[0.12] bg-[#0e131a]/90 px-3 py-2 text-left backdrop-blur-md transition-all",
        "hover:-translate-y-0.5 hover:shadow-[0_0_14px_-6px_rgba(255,255,255,0.25)]",
        selected && "ring-2 ring-white/60 shadow-[0_0_18px_-4px_rgba(255,255,255,0.35)]",
      )}
      style={{ width: 240, minHeight: TREE_NODE_HEIGHT - 2 }}
    >
      <div className="flex items-center gap-1.5 truncate text-sm font-semibold">
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <span className="truncate">{data.name}</span>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/60">{data.path}</div>
      <span className="absolute right-3 top-3 inline-block h-2 w-2 rounded-sm" style={{ background: extColor(data.ext) }} />
    </button>
  );
}

function MoreNodeComponent({ data }: NodeProps<MoreFlowNode>) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        data.onLoadMore();
      }}
      className="glass-heavy flex w-[240px] items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <span>Load more</span>
      <span className="font-mono text-[10px]">{data.hidden} hidden</span>
    </button>
  );
}

function PanelManager({
  panels,
  activePanelId,
  onFocus,
  onClose,
  onUpdatePanel,
  onSaveEditor,
}: {
  panels: PanelState[];
  activePanelId: string | null;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onUpdatePanel: (id: string, patch: Partial<PanelState>) => void;
  onSaveEditor: (panel: EditorPanelState) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40">
      {panels.map((panel) => (
        <ManagedPanel
          key={panel.id}
          panel={panel}
          active={panel.id === activePanelId}
          onFocus={onFocus}
          onClose={onClose}
          onUpdatePanel={onUpdatePanel}
          onSaveEditor={onSaveEditor}
        />
      ))}
    </div>
  );
}

function ManagedPanel({
  panel,
  active,
  onFocus,
  onClose,
  onUpdatePanel,
  onSaveEditor,
}: {
  panel: PanelState;
  active: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
  onUpdatePanel: (id: string, patch: Partial<PanelState>) => void;
  onSaveEditor: (panel: EditorPanelState) => void;
}) {
  const dragRef = useRef<{ mode: "move" | "resize"; startX: number; startY: number; rect: PanelState["rect"] } | null>(
    null,
  );
  const Icon = panel.kind === "editor" ? Code2 : TerminalIcon;

  useEffect(() => {
    function onMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.mode === "move") {
        onUpdatePanel(panel.id, {
          rect: clampPanelRect({ ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy }),
        } as Partial<PanelState>);
      } else {
        onUpdatePanel(panel.id, {
          rect: clampPanelRect({
            ...drag.rect,
            width: drag.rect.width + dx,
            height: drag.rect.height + dy,
          }),
        } as Partial<PanelState>);
      }
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onUpdatePanel, panel.id]);

  return (
    <section
      className={cn(
        "pointer-events-auto absolute flex flex-col overflow-hidden rounded-lg border bg-[#10151d]/95 shadow-2xl backdrop-blur-md",
        panel.kind === "editor" ? "border-cyan-400/30" : "border-emerald-400/30",
        active && "ring-2 ring-white/55",
      )}
      style={{
        left: panel.rect.x,
        top: panel.rect.y,
        width: panel.rect.width,
        height: panel.rect.height,
        zIndex: panel.z,
      }}
      onPointerDown={() => onFocus(panel.id)}
    >
      <header
        className="flex h-9 cursor-grab select-none items-center gap-2 border-b border-white/10 bg-black/40 px-3 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/85 active:cursor-grabbing"
        onPointerDown={(event) => {
          event.preventDefault();
          onFocus(panel.id);
          dragRef.current = {
            mode: "move",
            startX: event.clientX,
            startY: event.clientY,
            rect: panel.rect,
          };
        }}
      >
        <Icon className={cn("h-3.5 w-3.5", panel.kind === "editor" ? "text-cyan-300" : "text-emerald-300")} />
        <span className="min-w-0 flex-1 truncate">
          {panel.title}
          {panel.kind === "editor" && panel.dirty ? " *" : ""}
        </span>
        {panel.kind === "editor" ? (
          <button
            type="button"
            title="Save"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSaveEditor(panel)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5 rotate-45" />
          </button>
        ) : null}
        <button
          type="button"
          title="Close"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onClose(panel.id)}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-white/[0.08] hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {panel.kind === "editor" ? (
          <div
            className="h-full"
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                onSaveEditor(panel);
              }
            }}
          >
            <MonacoEditor
              value={panel.draftBody}
              language={languageForFile(panel.path.split("/").pop() ?? "")}
              onChange={(draftBody) => onUpdatePanel(panel.id, { draftBody, dirty: true } as Partial<PanelState>)}
            />
          </div>
        ) : (
          <div className="h-full p-2">
            <TerminalNodeView cwd={panel.cwd} />
          </div>
        )}
      </div>
      <button
        type="button"
        title="Resize"
        aria-label="Resize panel"
        className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize text-muted-foreground/40"
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onFocus(panel.id);
          dragRef.current = {
            mode: "resize",
            startX: event.clientX,
            startY: event.clientY,
            rect: panel.rect,
          };
        }}
      >
        <PanelTopClose className="h-4 w-4 rotate-90" />
      </button>
    </section>
  );
}

function GraphActionNodeComponent({ data, selected }: NodeProps<GraphActionFlowNode>) {
  const definition = GRAPH_NODE_DEFINITIONS[data.node.kind];
  const failed = data.lastStep?.status === "failed";
  const completed = data.lastStep?.status === "completed";
  return (
    <div
      className={cn(
        "relative rounded-lg border bg-[#111820]/95 pb-3 pt-2 text-left shadow-xl backdrop-blur-md transition-all",
        failed ? "border-rose-400/60" : completed ? "border-emerald-400/50" : "border-sky-400/35",
        selected && "ring-2 ring-white/60",
      )}
      style={{ width: 310, minHeight: 190 }}
    >
      {definition.inputs.map((pin, index) => (
        <PinHandle key={pin.id} pin={pin} index={index} side="input" />
      ))}
      {definition.outputs.map((pin, index) => (
        <PinHandle key={pin.id} pin={pin} index={index} side="output" />
      ))}

      <div className="flex items-center gap-2 border-b border-white/10 px-3 pb-2">
        <Boxes className="h-4 w-4 text-sky-300" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{definition.label}</div>
          <div className="truncate font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">
            {data.node.kind}
          </div>
        </div>
        {data.lastStep ? (
          <span
            className={cn(
              "ml-auto rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.14em]",
              failed ? "bg-rose-500/20 text-rose-100" : "bg-emerald-500/20 text-emerald-100",
            )}
          >
            {data.lastStep.status}
          </span>
        ) : null}
      </div>

      <div className="space-y-2 px-3 pt-3">
        {data.node.kind.startsWith("fs.") ? (
          <GraphTextInput
            label="path"
            value={data.node.config.path ?? ""}
            placeholder="/absolute/path"
            onChange={(path) => data.onConfigChange({ path })}
          />
        ) : null}
        {data.node.kind === "fs.write" ? (
          <GraphTextArea
            label="text"
            value={data.node.config.text ?? ""}
            placeholder="text to write"
            onChange={(text) => data.onConfigChange({ text })}
          />
        ) : null}
        {data.node.kind === "terminal.run" ? (
          <>
            <GraphTextInput
              label="command"
              value={data.node.config.command ?? ""}
              placeholder="bun --version"
              onChange={(command) => data.onConfigChange({ command })}
            />
            <GraphTextInput
              label="cwd"
              value={data.node.config.cwd ?? ""}
              placeholder="/working/directory"
              onChange={(cwd) => data.onConfigChange({ cwd })}
            />
          </>
        ) : null}
        {data.lastStep?.error ? <IssueBox tone="error" message={data.lastStep.error} /> : null}
        {data.issues.length > 0 ? <IssueBox tone="warning" message={data.issues[0]?.message ?? ""} /> : null}
      </div>
    </div>
  );
}

function PinHandle({
  pin,
  index,
  side,
}: {
  pin: { id: string; label: string; type: string };
  index: number;
  side: "input" | "output";
}) {
  const top = 60 + index * 24;
  const isInput = side === "input";
  return (
    <>
      <Handle
        type={isInput ? "target" : "source"}
        id={`${isInput ? "in" : "out"}:${pin.id}:${pin.type}`}
        position={isInput ? Position.Left : Position.Right}
        style={{
          top,
          width: 10,
          height: 10,
          background: pinColor(pin.type),
          border: "2px solid rgba(0,0,0,0.7)",
        }}
      />
      <span
        className={cn(
          "pointer-events-none absolute font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60",
          isInput ? "left-3" : "right-3",
        )}
        style={{ top: top - 6 }}
      >
        {pin.label}
      </span>
    </>
  );
}

function GraphTextInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        className="mt-1 w-full rounded-md border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/35 focus:border-sky-400/50"
      />
    </label>
  );
}

function GraphTextArea({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground/60">{label}</span>
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onPointerDown={(event) => event.stopPropagation()}
        rows={3}
        className="mt-1 w-full resize-none rounded-md border border-white/10 bg-black/30 px-2 py-1.5 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/35 focus:border-sky-400/50"
      />
    </label>
  );
}

function GraphRunInspector({
  graph,
  issues,
  lastRun,
  selectedNodeId,
  onRunGraph,
  onAddNode,
  onFocusNode,
}: {
  graph: CanvasGraph;
  issues: GraphIssue[];
  lastRun: GraphExecutionResult | null;
  selectedNodeId: string | null;
  onRunGraph: () => void;
  onAddNode: (kind: GraphNodeKind) => void;
  onFocusNode: (id: string) => void;
}) {
  const failed = lastRun?.steps.find((step) => step.status === "failed") ?? null;
  return (
    <aside className="glass-heavy pointer-events-auto absolute right-5 top-16 z-30 flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-lg border border-white/10 p-3 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2">
        <Boxes className="h-4 w-4 text-sky-300" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Graph Run</div>
          <div className="truncate font-mono text-[10px] text-muted-foreground/60">
            {graph.nodes.length} nodes - {graph.edges.length} wires
          </div>
        </div>
        <button
          type="button"
          title="Run graph"
          onClick={onRunGraph}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-sky-400/15 text-sky-100 hover:bg-sky-400/25"
        >
          <Play className="h-4 w-4" />
        </button>
      </div>

      {graph.nodes.length === 0 ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Add a graph node to start an executable workflow.</div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.values(GRAPH_NODE_DEFINITIONS).map((definition) => (
              <button
                type="button"
                key={definition.kind}
                onClick={() => onAddNode(definition.kind)}
                className="rounded-md border border-white/10 px-2 py-1.5 text-left text-[12px] hover:bg-white/[0.07]"
              >
                {definition.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {issues.length > 0 ? <IssueBox tone="warning" message={issues[0]?.message ?? ""} /> : null}
      {failed ? <IssueBox tone="error" message={failed.error ?? "graph execution failed"} /> : null}

      {lastRun ? (
        <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {lastRun.steps.map((step) => (
            <button
              type="button"
              key={`${lastRun.startedAt}-${step.nodeId}`}
              onClick={() => onFocusNode(step.nodeId)}
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-[12px]",
                step.status === "failed"
                  ? "border-rose-400/30 bg-rose-500/10 text-rose-100"
                  : "border-white/10 bg-white/[0.03]",
                selectedNodeId === step.nodeId && "ring-1 ring-white/50",
              )}
            >
              <span className="truncate">{GRAPH_NODE_DEFINITIONS[step.kind].label}</span>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">{step.status}</span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function Finder({
  query,
  results,
  onQueryChange,
  onPick,
  onClose,
}: {
  query: string;
  results: FinderResult[];
  onQueryChange: (query: string) => void;
  onPick: (result: FinderResult) => void;
  onClose: () => void;
}) {
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (highlight >= results.length) setHighlight(0);
  }, [highlight, results.length]);

  return (
    <div className="fixed inset-0 z-[70] bg-black/20 backdrop-blur-[2px]" data-context-menu>
      <div className="glass-heavy absolute left-1/2 top-20 flex w-[680px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-white/10 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((current) => (results.length === 0 ? 0 : (current - 1 + results.length) % results.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const result = results[highlight];
                if (result) onPick(result);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Find files, panels, graph nodes, commands, or jump to /absolute/path"
            className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-muted-foreground/45"
          />
        </div>
        <div className="max-h-[440px] overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-5 text-sm text-muted-foreground">No matches</div>
          ) : (
            results.map((result, index) => (
              <button
                type="button"
                key={result.id}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => onPick(result)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                  index === highlight && "bg-white/[0.10]",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{result.label}</span>
                  {result.detail ? (
                    <span className="block truncate font-mono text-[10px] text-muted-foreground/60">{result.detail}</span>
                  ) : null}
                </span>
                <span className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  {result.kind}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function NativeModal({ request, onClose }: { request: ModalRequest; onClose: () => void }) {
  const [value, setValue] = useState(request.kind === "prompt" ? request.defaultValue : "");
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 backdrop-blur-sm" data-context-menu>
      <form
        className="glass-heavy w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-white/10 p-4 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (request.kind === "prompt") {
            const trimmed = value.trim();
            if (!trimmed) return;
            request.onSubmit(trimmed);
          } else {
            request.onConfirm();
          }
          onClose();
        }}
      >
        <div className="text-base font-semibold">{request.title}</div>
        <div className="mt-1 break-all text-sm text-muted-foreground">{request.message}</div>
        {request.kind === "prompt" ? (
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-4 w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-sky-400/50"
          />
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-white/10 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            className={cn(
              "rounded-md px-3 py-1.5 text-sm text-white",
              request.kind === "confirm" && request.destructive
                ? "bg-rose-500/80 hover:bg-rose-500"
                : "bg-sky-500/80 hover:bg-sky-500",
            )}
          >
            {request.confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function IssueBox({ tone, message }: { tone: "warning" | "error"; message: string }) {
  return (
    <div
      className={cn(
        "rounded-md px-2 py-1 text-[11px]",
        tone === "warning" ? "bg-amber-500/10 text-amber-100" : "bg-rose-500/10 text-rose-100",
      )}
    >
      {message}
    </div>
  );
}

function buildFinderResults(args: {
  query: string;
  session: CanvasSession;
  fileTrees: Map<string, FsEntry[]>;
  commands: CommandDefinition[];
  visibleNodeIds: string[];
}): FinderResult[] {
  const query = args.query.trim();
  const results: FinderResult[] = [];
  const visible = new Set(args.visibleNodeIds);

  for (const entries of args.fileTrees.values()) {
    for (const entry of entries) {
      const id = `entry:${entry.path}`;
      if (!visible.has(`tree:${entry.path}`)) continue;
      results.push({
        id,
        label: entry.name,
        detail: entry.path,
        kind: entry.kind === "dir" ? "folder" : "file",
      });
    }
  }

  for (const panel of args.session.openPanels) {
    results.push({
      id: `panel:${panel.id}`,
      label: panel.title,
      detail: panel.kind === "editor" ? panel.path : panel.cwd,
      kind: "panel",
    });
  }

  for (const node of args.session.graph.nodes) {
    results.push({
      id: `graph-result:${node.id}`,
      label: GRAPH_NODE_DEFINITIONS[node.kind].label,
      detail: node.label ?? node.kind,
      kind: "graph",
    });
  }

  for (const command of args.commands) {
    if (!command.enabled().enabled) continue;
    results.push({
      id: `command:${command.id}`,
      label: command.label,
      detail: command.hint,
      kind: "command",
    });
  }

  if (query.startsWith("/")) {
    results.unshift({
      id: `path:${query}`,
      label: query,
      detail: query,
      kind: "path",
    });
  }

  if (!query) return results.slice(0, 60);
  return results
    .filter((result) => matches(query.toLowerCase(), `${result.kind} ${result.label} ${result.detail ?? ""}`))
    .slice(0, 60);
}

function treeEdge(source: string, target: string): Edge {
  return {
    id: `tree:${source}->${target}`,
    source,
    target,
    type: "smoothstep",
    selectable: false,
    focusable: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: "rgba(255,255,255,0.24)" },
    style: { stroke: "rgba(255,255,255,0.18)", strokeWidth: 1.2 },
  };
}

function graphEdgeToFlow(edge: GraphEdge, issues: GraphIssue[]): Edge {
  const invalid = issues.some((issue) => issue.edgeId === edge.id && issue.severity === "error");
  const sourcePin = pinTypeFor(edge.sourcePin);
  return {
    id: `exec:${edge.id}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: `out:${edge.sourcePin}:${sourcePin}`,
    targetHandle: `in:${edge.targetPin}:${sourcePin}`,
    type: "smoothstep",
    animated: !invalid,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: invalid ? "#fb7185" : "#38bdf8" },
    style: { stroke: invalid ? "#fb7185" : "#38bdf8", strokeWidth: 2 },
  };
}

function edgeFromConnection(connection: Connection): GraphEdge | null {
  if (!connection.source || !connection.target || !connection.sourceHandle || !connection.targetHandle) {
    return null;
  }
  const sourcePin = parseHandle(connection.sourceHandle, "out");
  const targetPin = parseHandle(connection.targetHandle, "in");
  if (!sourcePin || !targetPin) return null;
  return {
    id: `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    source: connection.source,
    sourcePin: sourcePin.id,
    target: connection.target,
    targetPin: targetPin.id,
  };
}

function validateNewEdge(graph: CanvasGraph, edge: GraphEdge): string | null {
  if (edge.source === edge.target) return "self-connections are not executable";
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  if (!source || !target) return "connections are only supported between graph action nodes";
  const sourcePin = GRAPH_NODE_DEFINITIONS[source.kind].outputs.find((pin) => pin.id === edge.sourcePin);
  const targetPin = GRAPH_NODE_DEFINITIONS[target.kind].inputs.find((pin) => pin.id === edge.targetPin);
  if (!sourcePin || !targetPin) return "unknown pin";
  if (sourcePin.type !== targetPin.type) return `${sourcePin.type} cannot connect to ${targetPin.type}`;
  const duplicate = graph.edges.some(
    (candidate) =>
      candidate.source === edge.source &&
      candidate.sourcePin === edge.sourcePin &&
      candidate.target === edge.target &&
      candidate.targetPin === edge.targetPin,
  );
  return duplicate ? "that wire already exists" : null;
}

function parseHandle(handle: string, expectedSide: "in" | "out"): { id: string; type: string } | null {
  const [side, id, type] = handle.split(":");
  if (side !== expectedSide || !id || !type) return null;
  return { id, type };
}

function makeEditorPanel(path: string, body: string, panels: PanelState[]): EditorPanelState {
  const now = nowIso();
  return {
    id: `editor:${path}`,
    kind: "editor",
    title: path.split("/").pop() || path,
    path,
    draftBody: body,
    dirty: false,
    rect: defaultPanelRect(panels.length),
    z: maxPanelZ(panels) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

function makeTerminalPanel(cwd: string, panels: PanelState[]): PanelState {
  const now = nowIso();
  return {
    id: `terminal:${cwd}`,
    kind: "terminal",
    title: `terminal - ${cwd}`,
    cwd,
    rect: defaultPanelRect(panels.length),
    z: maxPanelZ(panels) + 1,
    createdAt: now,
    updatedAt: now,
  };
}

function defaultPanelRect(index: number) {
  return clampPanelRect({
    x: 320 + (index % 3) * 28,
    y: 82 + (index % 3) * 28,
    width: 760,
    height: 460,
  });
}

function clampPanelRect(rect: { x: number; y: number; width: number; height: number }) {
  const maxWidth = Math.max(PANEL_MIN_WIDTH, window.innerWidth - 32);
  const maxHeight = Math.max(PANEL_MIN_HEIGHT, window.innerHeight - 112);
  const width = Math.min(Math.max(PANEL_MIN_WIDTH, rect.width), maxWidth);
  const height = Math.min(Math.max(PANEL_MIN_HEIGHT, rect.height), maxHeight);
  return {
    width,
    height,
    x: Math.min(Math.max(16, rect.x), Math.max(16, window.innerWidth - width - 16)),
    y: Math.min(Math.max(64, rect.y), Math.max(64, window.innerHeight - height - 92)),
  };
}

function maxPanelZ(panels: PanelState[]): number {
  return panels.reduce((max, panel) => Math.max(max, panel.z), 0);
}

function findEntry(fileTrees: Map<string, FsEntry[]>, path: string): FsEntry | null {
  const parent = parentPath(path);
  return fileTrees.get(parent)?.find((entry) => entry.path === path) ?? null;
}

function defaultConfigFor(kind: GraphNodeKind, address: string): GraphNodeConfig {
  if (kind === "fs.read") return { path: address };
  if (kind === "fs.write") return { path: joinPath(address, "untitled.txt"), text: "" };
  if (kind === "fs.mkdir") return { path: joinPath(address, "new-folder") };
  if (kind === "fs.delete") return { path: address };
  return { cwd: address, command: "pwd", timeoutMs: 10_000 };
}

function extColor(ext: string): string {
  switch (ext) {
    case "md":
    case "markdown":
      return "rgba(139,92,246,0.7)";
    case "json":
      return "rgba(34,211,238,0.7)";
    case "yaml":
    case "yml":
      return "rgba(245,158,11,0.7)";
    case "ts":
    case "tsx":
      return "rgba(16,185,129,0.7)";
    default:
      return "rgba(255,255,255,0.4)";
  }
}

function pinColor(type: string): string {
  if (type === "trigger") return "rgb(56,189,248)";
  if (type === "path" || type === "cwd") return "rgb(167,139,250)";
  if (type === "text" || type === "command") return "rgb(16,185,129)";
  if (type === "error") return "rgb(251,113,133)";
  return "rgb(245,158,11)";
}

function pinTypeFor(pinId: string) {
  if (pinId === "done" || pinId === "in") return "trigger";
  if (pinId === "cwd") return "cwd";
  if (pinId === "command") return "command";
  if (pinId === "result") return "result";
  if (pinId === "error") return "error";
  if (pinId === "path") return "path";
  return "text";
}

function extensionForKind(kind: "markdown" | "json" | "yaml" | "typescript" | "plain"): string {
  if (kind === "markdown") return "md";
  if (kind === "typescript") return "ts";
  if (kind === "yaml") return "yaml";
  if (kind === "json") return "json";
  return "txt";
}

function breadcrumbSegments(address: string, onJump: (path: string) => void) {
  const trimmed = address.replace(/^\/+/, "").replace(/\/+$/, "");
  const parts = trimmed ? trimmed.split("/") : [];
  const segments: Array<{ id: string; label: string; onClick?: () => void }> = [
    { id: "/", label: "/", onClick: address === "/" ? undefined : () => onJump("/") },
  ];
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    acc = `${acc}/${part}`;
    const target = acc;
    const isLast = i === parts.length - 1;
    segments.push({ id: target, label: part, onClick: isLast ? undefined : () => onJump(target) });
  }
  return segments;
}

function menuTitleFor(nodeId: string | undefined, address: string): string {
  if (!nodeId) return `Actions on ${address}`;
  const treePath = extractTreePath(nodeId);
  if (treePath) return `Actions on ${treePath}`;
  const morePath = extractMorePath(nodeId);
  if (morePath) return `More items in ${morePath}`;
  if (nodeId.startsWith("graph-")) return "Actions on graph node";
  return "Actions on canvas";
}

function joinPath(parent: string, name: string): string {
  if (parent === "/" || parent === "") return `/${name}`;
  return `${parent}/${name}`;
}

function parentPath(absPath: string): string {
  if (!absPath || absPath === "/") return "/";
  const idx = absPath.lastIndexOf("/");
  if (idx <= 0) return "/";
  return absPath.slice(0, idx);
}

function matches(query: string, target: string): boolean {
  const text = target.toLowerCase();
  let i = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, i);
    if (found === -1) return false;
    i = found + 1;
  }
  return true;
}

function nowIso(): string {
  return new Date().toISOString();
}
