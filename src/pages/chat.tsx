import { useState, useRef, useEffect } from "react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { Eye, MessageSquare } from "lucide-react";
import { ChatPanel } from "../components/ChatPanel";
import { PreviewPanel } from "../components/preview_panel/PreviewPanel";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isPreviewOpenAtom, isChatPanelHiddenAtom } from "@/atoms/viewAtoms";
import { useChats } from "@/hooks/useChats";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { ipc } from "@/ipc/types";
import { useChatStreamManager } from "@/chat_stream/ChatStreamProvider";
import { useIsMobile } from "@/hooks/use-mobile";

const DEFAULT_CHAT_PANEL_SIZE = 50;

export default function ChatPage() {
  const { id: chatId, appId: routeAppId } = useSearch({ from: "/chat" });
  const navigate = useNavigate();
  const [isPreviewOpen, setIsPreviewOpen] = useAtom(isPreviewOpenAtom);
  const [isChatPanelHidden, setIsChatPanelHidden] = useAtom(
    isChatPanelHiddenAtom,
  );
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const [isResizing, setIsResizing] = useState(false);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const { chats, loading } = useChats(selectedAppId);
  const previousSizeRef = useRef<number>(DEFAULT_CHAT_PANEL_SIZE);
  const isInitialMountRef = useRef(true);
  const selectedAppIdRef = useRef(selectedAppId);

  useEffect(() => {
    selectedAppIdRef.current = selectedAppId;
  }, [selectedAppId]);

  // Sync selectedChatIdAtom with the chatId from the URL
  useEffect(() => {
    setSelectedChatId(chatId ?? null);
  }, [chatId, setSelectedChatId]);

  useEffect(() => {
    if (chatId || loading) {
      return;
    }

    if (!selectedAppId) {
      navigate({ to: "/", replace: true });
      return;
    }

    if (chats.length) {
      // Not a real navigation, just a redirect, when the user navigates to /chat
      // without a chatId, we redirect to the first chat
      setSelectedAppId(chats[0].appId);
      navigate({
        to: "/chat",
        search: { id: chats[0].id, appId: chats[0].appId },
        replace: true,
      });
      return;
    }

    navigate({
      to: "/app-details",
      search: { appId: selectedAppId },
      replace: true,
    });
  }, [chatId, chats, loading, navigate, selectedAppId, setSelectedAppId]);

  useEffect(() => {
    if (!chatId) {
      return;
    }

    if (routeAppId) {
      if (routeAppId !== selectedAppIdRef.current) {
        selectedAppIdRef.current = routeAppId;
        setSelectedAppId(routeAppId);
      }
      return;
    }

    // If chatId is already in our loaded chats list, selectedAppId is correct
    // for this chat (useChats filters by selectedAppId), so skip the IPC fetch.
    if (chats.some((c) => c.id === chatId)) {
      return;
    }

    let isCancelled = false;
    ipc.chat
      .getChat(chatId)
      .then((chat) => {
        if (!isCancelled && chat.appId !== selectedAppIdRef.current) {
          selectedAppIdRef.current = chat.appId;
          setSelectedAppId(chat.appId);
        }
      })
      .catch(() => {
        // Let the chat panel surface any load error for the selected chat.
      });
    return () => {
      isCancelled = true;
    };
  }, [chatId, routeAppId, chats, setSelectedAppId]);

  useEffect(() => {
    if (isPreviewOpen) {
      ref.current?.expand();
    } else {
      ref.current?.collapse();
    }
  }, [isPreviewOpen]);
  const ref = useRef<ImperativePanelHandle>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);

  // Keep chat panel size in sync with hidden state (from toolbar button / other views)
  useEffect(() => {
    if (!chatPanelRef.current) return;
    // Skip the initial mount to preserve persisted panel size from autoSaveId
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (isChatPanelHidden) {
      // Save current size before collapsing
      const currentSize = chatPanelRef.current.getSize();
      if (currentSize > 5) {
        previousSizeRef.current = currentSize;
      }
      // Visually collapsed but keep a sliver so the handle is usable
      chatPanelRef.current.resize(1);
    } else {
      // Restore to previous size when re-opened via button
      chatPanelRef.current.resize(previousSizeRef.current);
    }
  }, [isChatPanelHidden]);

  // ---------------------------------------------------------------------------
  // Sandbox lifecycle: hibernate the app's sandbox when the user leaves the
  // app builder. The web server pauses (not kills) E2B sandboxes, so the next
  // visit resumes with the same data in seconds.
  // ---------------------------------------------------------------------------
  const chatStreamManager = useChatStreamManager();
  const isMobile = useIsMobile();
  const [mobileShowPreview, setMobileShowPreview] = useState(false);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  useEffect(() => {
    const appIdAtEffectStart = selectedAppId;
    return () => {
      if (appIdAtEffectStart == null) return;
      // Stay alive while the user is still inside the app's own surfaces
      // (chat view or the app details page for this app).
      const path = window.location.pathname;
      if (path.startsWith("/chat")) return;
      if (path.startsWith("/app-details")) return;
      // Never hibernate mid-build: agent tools need the live sandbox.
      const busy = chatsRef.current.some((c) =>
        chatStreamManager.getIsStreaming(c.id),
      );
      if (busy) return;
      void ipc.app.stopApp({ appId: appIdAtEffectStart }).catch(() => {
        /* already stopped or stopping */
      });
    };
  }, [selectedAppId, chatStreamManager]);

  // ---------------------------------------------------------------------------
  // Mobile: single-pane layout (chat OR preview) with a floating switcher.
  // ---------------------------------------------------------------------------
  if (isMobile) {
    return (
      <div className="relative h-[calc(100dvh-2.25rem)] w-full overflow-hidden">
        <div className="absolute inset-0">
          {!isChatPanelHidden && (
            <ChatPanel
              chatId={chatId}
              isPreviewOpen={isPreviewOpen}
              onTogglePreview={() => {
                setIsPreviewOpen(!isPreviewOpen);
              }}
            />
          )}
        </div>
        {mobileShowPreview && (
          <div className="absolute inset-0 z-10 bg-background">
            <PreviewPanel />
          </div>
        )}
        <button
          type="button"
          onClick={() => setMobileShowPreview((v) => !v)}
          aria-label={mobileShowPreview ? "Show chat" : "Show preview"}
          className={cn(
            "absolute bottom-4 right-4 z-20 flex items-center gap-1.5 rounded-full border border-border/70 bg-popover px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur transition-colors",
            mobileShowPreview
              ? "text-foreground hover:bg-accent"
              : "text-popover-foreground hover:bg-accent",
          )}
        >
          {mobileShowPreview ? (
            <>
              <MessageSquare className="size-3.5" />
              Chat
            </>
          ) : (
            <>
              <Eye className="size-3.5" />
              Preview
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <PanelGroup autoSaveId="persistence" direction="horizontal">
      <Panel
        id="chat-panel"
        ref={chatPanelRef}
        collapsible
        minSize={1}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <div className="h-full w-full">
          {!isChatPanelHidden && (
            <ChatPanel
              chatId={chatId}
              isPreviewOpen={isPreviewOpen}
              onTogglePreview={() => {
                setIsPreviewOpen(!isPreviewOpen);
                if (isPreviewOpen) {
                  ref.current?.collapse();
                } else {
                  ref.current?.expand();
                }
              }}
            />
          )}
        </div>
      </Panel>
      <PanelResizeHandle
        onDragging={(isDragging) => {
          setIsResizing(isDragging);
          // When dragging ends, sync the hidden state based on final width
          if (!isDragging) {
            // Small delay to let the panel settle
            requestAnimationFrame(() => {
              const panel = document.getElementById("chat-panel");
              if (panel) {
                const panelWidth = panel.getBoundingClientRect().width;
                const containerWidth =
                  panel.parentElement?.getBoundingClientRect().width || 1;
                const percentage = (panelWidth / containerWidth) * 100;
                // Consider hidden if panel is less than 5% width
                setIsChatPanelHidden(percentage < 5);
              }
            });
          }
        }}
        className={cn(
          "relative bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 transition-colors cursor-col-resize",
          isChatPanelHidden ? "w-2" : "w-1",
        )}
      />

      <Panel
        collapsible
        ref={ref}
        id="preview-panel"
        minSize={20}
        className={cn(!isResizing && "transition-all duration-100 ease-in-out")}
      >
        <PreviewPanel />
      </Panel>
    </PanelGroup>
  );
}
