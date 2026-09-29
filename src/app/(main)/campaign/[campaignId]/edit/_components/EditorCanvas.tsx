// 1. React/Next.js
import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
} from "react";

import type { Layer, Page, CollectionField, Asset } from "@/types/funnel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

type ViewportMode = "desktop" | "tablet" | "mobile";

interface EditorCenterCanvasProps {
  currentPageId: string | null;
  viewportMode: ViewportMode;
  setViewportMode: (mode: ViewportMode) => void;
  onLayerSelect?: (layerId: string) => void;
  onLayerDeselect?: () => void;
  onExitComponentEditMode?: () => void;
  //   liveLayerUpdates?: UseLiveLayerUpdatesReturn | null;
  //   liveComponentUpdates?: UseLiveComponentUpdatesReturn | null;
}

const EditorCenterCanvas = React.memo(function EditorCenterCanvas({
  currentPageId,
  viewportMode,
  setViewportMode,
  onLayerSelect,
  onLayerDeselect,
  onExitComponentEditMode,
  //   liveLayerUpdates,
  //   liveComponentUpdates,
}: EditorCenterCanvasProps) {
  return (
    <div className="flex-1 min-w-0 flex flex-col relative">
      {/* Top Bar */}

      {/* Canvas Area */}
      <div
        ref={canvasContainerRef}
        className="flex-1 relative overflow-hidden bg-neutral-50 dark:bg-neutral-950/80 select-none"
      >
        {/* Loading skeleton overlay when draft is being fetched */}
        {isDraftLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-50/80 dark:bg-neutral-950/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <div className="w-8 h-8 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span className="text-sm">Loading page...</span>
            </div>
          </div>
        )}

        {/* Selection overlay - renders outlines on top of the iframe */}
        {!isPreviewMode &&
          activeSidebarTab !== "pages" &&
          canvasIframeElement && (
            <SelectionOverlay
              iframeElement={canvasIframeElement}
              containerElement={scrollContainerRef.current}
              selectedLayerId={selectedLayerId}
              parentLayerId={parentLayerId}
              zoom={zoom}
              activeSublayerIndex={activeSublayerIndex}
              activeListItemIndex={activeListItemIndex}
            />
          )}

        {/* AI activity overlay - shimmering outlines on layers the agent is editing */}
        {!isPreviewMode &&
          activeSidebarTab !== "pages" &&
          canvasIframeElement && (
            <AiActivityOverlay
              iframeElement={canvasIframeElement}
              containerElement={scrollContainerRef.current}
              zoom={zoom}
            />
          )}

        {/* Drag capture overlay - prevents iframe from swallowing mouse events during drag */}
        {!isPreviewMode && <DragCaptureOverlay />}

        {/* Element picker SVG connector overlay */}
        <ElementPickerOverlay iframeElement={canvasIframeElement} zoom={zoom} />

        {/* Translation loading overlay — shown while translations for the
            active locale are being fetched. Mirrors the preview-mode overlay
            below for visual consistency. */}
        {isLocalizing && isLoadingTranslations && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background/80">
            <Spinner />
          </div>
        )}

        {/* Scrollable container with hidden scrollbars (editor canvas) */}
        <div
          ref={scrollContainerRef}
          className={cn(
            "absolute inset-0 z-0 overflow-auto",
            (elementPicker?.active || isAiLayerPicking) && "cursor-crosshair",
          )}
          style={{
            opacity: isCanvasReady && !isComponentCanvasSettling ? 1 : 0,
            transition: "opacity 120ms ease-out",
            scrollbarWidth: "none", // Firefox
            msOverflowStyle: "none", // IE/Edge
            WebkitOverflowScrolling: "touch",
          }}
          onClick={handleCanvasClick}
        >
          {/* Hide scrollbars for Webkit browsers */}
          <style jsx>{`
            div::-webkit-scrollbar {
              display: none;
            }
          `}</style>

          {/* Editor mode: Scaled canvas with zoom controls - always in DOM, never resized */}
          <div
            style={{
              position: "relative",
              minWidth: "100%",
              minHeight: "100%",
              // When editing a component, center the canvas inside the scroll area.
              // Rely on minHeight (not a fixed height) so the container grows with
              // tall content — a fixed height:100% would keep the centered child
              // overflowing past the unreachable top edge (flexbox centering clip).
              // Page editing keeps default block flow so absolute overlays anchor at the top.
              ...(editingComponentId
                ? {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }
                : null),
            }}
          >
            <div
              style={{
                // Width: exact scaled size, min 100% to fill viewport horizontally
                width: `${effectiveCanvasWidth * (zoom / 100) + CANVAS_PADDING}px`,
                minWidth: "100%",
                // Height: scaled iframe size + canvas padding. finalIframeHeight is
                // already stretched to fill the viewport at any zoom level, so the
                // white canvas always fills the available height.
                height: `${finalIframeHeight * (zoom / 100) + CANVAS_PADDING}px`,
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "center",
                paddingTop: `${CANVAS_BORDER}px`,
                position: "relative",
              }}
            >
              {/* Sizer: occupies the SCALED footprint so the scroll area,
                    centering, and drop shadow match the visible canvas size. */}
              <div
                className={
                  editingComponentId
                    ? "relative"
                    : "bg-white shadow-3xl relative"
                }
                style={{
                  width: `${effectiveCanvasWidth * (zoom / 100)}px`,
                  height: `${finalIframeHeight * (zoom / 100)}px`,
                  flexShrink: 0, // Prevent shrinking - maintain fixed size
                  // Clip overflow when canvas is smaller than iframe (component editing)
                  overflow: editingComponentId ? "hidden" : undefined,
                }}
              >
                {/* Stage: natural (unscaled) size, scaled with CSS transform from
                      the top-left corner. We deliberately use `transform: scale()`
                      instead of CSS `zoom`: Safari shrinks an iframe's content layout
                      viewport when an ancestor uses `zoom`, which rendered the page
                      too narrow (white space on the right) and misaligned the
                      selection overlay. transform keeps the iframe at its true
                      breakpoint width while only scaling the painted output. */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: `${effectiveCanvasWidth}px`,
                    height: `${finalIframeHeight}px`,
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: "top left",
                    // No transition to prevent shifts
                    transition: "none",
                  }}
                >
                  {/* Inner wrapper: keep iframe at viewport width for natural content rendering */}
                  <div
                    style={{
                      width:
                        editingComponentId &&
                        effectiveCanvasWidth < viewportWidth
                          ? `${viewportWidth}px`
                          : "100%",
                      height: "100%",
                    }}
                  >
                    {/* Canvas for editor */}
                    {layers.length > 0 ? (
                      <>
                        <Canvas
                          key={`editor-${currentPageId}`}
                          layers={layers}
                          components={components}
                          selectedLayerId={selectedLayerId}
                          hoveredLayerId={null}
                          breakpoint={viewportMode}
                          activeUIState={activeUIState}
                          editingComponentId={editingComponentId || null}
                          collectionItems={mergedCollectionItems}
                          collectionFields={collectionFieldsFromStore}
                          pageCollectionItem={translatedPageCollectionItem}
                          pageCollectionFields={pageCollectionFields}
                          currentLocale={selectedLocale}
                          availableLocales={locales}
                          translations={localeTranslations}
                          assets={assetsMap}
                          pageId={currentPageId || ""}
                          onLayerClick={handleCanvasLayerClick}
                          onLayerUpdate={handleCanvasLayerUpdate}
                          onDeleteLayer={
                            canEditStructure
                              ? handleCanvasDeleteLayer
                              : undefined
                          }
                          onContentHeightChange={setReportedContentHeight}
                          onContentWidthChange={
                            editingComponentId
                              ? setReportedContentWidth
                              : undefined
                          }
                          onGapUpdate={
                            canEditStructure ? handleCanvasGapUpdate : undefined
                          }
                          onZoomGesture={handleZoomGesture}
                          onZoomIn={zoomIn}
                          onZoomOut={zoomOut}
                          onResetZoom={resetZoom}
                          onZoomToFit={zoomToFit}
                          onAutofit={autofit}
                          onUndo={handleUndo}
                          onRedo={handleRedo}
                          liveLayerUpdates={liveLayerUpdates}
                          liveComponentUpdates={liveComponentUpdates}
                          onIframeReady={handleIframeReady}
                          onLayerHover={handleCanvasLayerHover}
                          onCanvasClick={handleCanvasClick}
                          onComponentEdit={
                            canEditStructure
                              ? handleCanvasComponentEdit
                              : undefined
                          }
                          editingComponentVariables={editingComponentVariables}
                          forceVisibleLayerIds={
                            activeInteractionTriggerLayerId
                              ? activeInteractionTargetLayerIds
                              : undefined
                          }
                          zoom={zoom}
                          referenceViewportHeight={defaultCanvasHeight}
                        />

                        {/* Drop indicator overlay - subscribes to store directly */}
                        <CanvasDropIndicatorOverlay
                          iframeElement={canvasIframeElement}
                        />

                        {/* Sibling reorder indicator overlay - for drag-to-reorder on canvas */}
                        <CanvasSiblingReorderOverlay
                          iframeElement={canvasIframeElement}
                        />

                        {/* Build skeleton: instant placeholder while the AI assembles
                          the page, shown until the first real layers stream in. */}
                        {isCanvasEmpty &&
                          aiBuildingPageId === currentPageId && (
                            <CanvasBuildSkeleton />
                          )}

                        {/* Empty overlay when only Body with no children */}
                        {isCanvasEmpty &&
                          aiBuildingPageId !== currentPageId && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                              <div className="pointer-events-auto">
                                <Empty className="bg-transparent border-0 text-neutral-900">
                                  <EmptyContent>
                                    <EmptyMedia
                                      variant="icon"
                                      className="size-9 mb-0 bg-neutral-900/5"
                                    >
                                      <Icon
                                        name="layout"
                                        className="size-3 text-neutral-900"
                                      />
                                    </EmptyMedia>
                                    <EmptyHeader>
                                      <EmptyTitle className="text-sm">
                                        {canEditStructure
                                          ? "Start building"
                                          : "No content yet"}
                                      </EmptyTitle>
                                      <EmptyDescription>
                                        {canEditStructure
                                          ? "Add your first block to begin creating your page."
                                          : "This page has no content to edit yet."}
                                      </EmptyDescription>
                                    </EmptyHeader>
                                    {canEditStructure && (
                                      <Button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          window.dispatchEvent(
                                            new CustomEvent(
                                              "toggleElementLibrary",
                                              {
                                                detail: { tab: "layouts" },
                                              },
                                            ),
                                          );
                                        }}
                                        size="sm"
                                        variant="secondary"
                                        className="bg-neutral-900/5 hover:bg-neutral-900/10 text-neutral-900"
                                      >
                                        <Icon name="plus" />
                                        Add layout
                                      </Button>
                                    )}
                                  </EmptyContent>
                                </Empty>
                              </div>
                            </div>
                          )}
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-12">
                        <div className="text-center max-w-md relative">
                          <div className="w-20 h-20 bg-linear-to-br from-blue-100 to-blue-50 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                            <Icon
                              name="layout"
                              className="w-10 h-10 text-blue-500"
                            />
                          </div>
                          <h2 className="text-2xl font-bold text-gray-900 mb-3">
                            {canEditStructure
                              ? "Start building"
                              : "No content yet"}
                          </h2>
                          <p className="text-gray-600 mb-8">
                            {canEditStructure
                              ? "Add your first block to begin creating your page."
                              : "This page has no content to edit yet."}
                          </p>
                          {canEditStructure && (
                            <div className="relative inline-block">
                              <Button
                                onClick={() =>
                                  setShowAddBlockPanel(!showAddBlockPanel)
                                }
                                size="lg"
                                className="gap-2"
                                disabled={
                                  !!(
                                    selectedLocale && !selectedLocale.is_default
                                  )
                                }
                              >
                                <Icon name="plus" className="w-5 h-5" />
                                Add Block
                              </Button>

                              {/* Add Block Panel */}
                              {showAddBlockPanel && currentPageId && (
                                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-200 rounded-lg shadow-2xl min-w-60">
                                  <div className="p-2">
                                    <div className="text-xs text-gray-500 px-3 py-2 mb-1 font-medium">
                                      Choose a block
                                    </div>

                                    <Button
                                      onClick={() => {
                                        // Always add inside Body container
                                        const result = addLayerFromTemplate(
                                          currentPageId,
                                          "body",
                                          "div",
                                        );
                                        if (result && liveLayerUpdates) {
                                          // Get FRESH state and find actual parent
                                          const freshDraft =
                                            usePagesStore.getState()
                                              .draftsByPageId[currentPageId];
                                          if (freshDraft) {
                                            const findLayerWithParent = (
                                              layers: Layer[],
                                              id: string,
                                              parent: Layer | null = null,
                                            ): {
                                              layer: Layer;
                                              parent: Layer | null;
                                            } | null => {
                                              for (const l of layers) {
                                                if (l.id === id)
                                                  return { layer: l, parent };
                                                if (l.children) {
                                                  const found =
                                                    findLayerWithParent(
                                                      l.children,
                                                      id,
                                                      l,
                                                    );
                                                  if (found) return found;
                                                }
                                              }
                                              return null;
                                            };
                                            const found = findLayerWithParent(
                                              freshDraft.layers,
                                              result.newLayerId,
                                            );
                                            if (found?.layer) {
                                              const actualParentId =
                                                found.parent?.id || null;
                                              liveLayerUpdates.broadcastLayerAdd(
                                                currentPageId,
                                                actualParentId,
                                                "div",
                                                found.layer,
                                              );
                                            }
                                          }
                                        }
                                        setShowAddBlockPanel(false);
                                      }}
                                      variant="ghost"
                                      className="w-full justify-start gap-3 px-3 py-3 h-auto"
                                    >
                                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                        <Icon
                                          name="container"
                                          className="w-5 h-5 text-gray-700"
                                        />
                                      </div>
                                      <div className="text-left">
                                        <div className="text-sm font-semibold text-gray-900">
                                          Div
                                        </div>
                                        <div className="text-xs text-gray-500">
                                          Container element
                                        </div>
                                      </div>
                                    </Button>

                                    <Button
                                      onClick={() => {
                                        // Always add inside Body container
                                        const result = addLayerFromTemplate(
                                          currentPageId,
                                          "body",
                                          "heading",
                                        );
                                        if (result && liveLayerUpdates) {
                                          // Get FRESH state and find actual parent
                                          const freshDraft =
                                            usePagesStore.getState()
                                              .draftsByPageId[currentPageId];
                                          if (freshDraft) {
                                            const findLayerWithParent = (
                                              layers: Layer[],
                                              id: string,
                                              parent: Layer | null = null,
                                            ): {
                                              layer: Layer;
                                              parent: Layer | null;
                                            } | null => {
                                              for (const l of layers) {
                                                if (l.id === id)
                                                  return { layer: l, parent };
                                                if (l.children) {
                                                  const found =
                                                    findLayerWithParent(
                                                      l.children,
                                                      id,
                                                      l,
                                                    );
                                                  if (found) return found;
                                                }
                                              }
                                              return null;
                                            };
                                            const found = findLayerWithParent(
                                              freshDraft.layers,
                                              result.newLayerId,
                                            );
                                            if (found?.layer) {
                                              const actualParentId =
                                                found.parent?.id || null;
                                              liveLayerUpdates.broadcastLayerAdd(
                                                currentPageId,
                                                actualParentId,
                                                "heading",
                                                found.layer,
                                              );
                                            }
                                          }
                                        }
                                        setShowAddBlockPanel(false);
                                      }}
                                      variant="ghost"
                                      className="w-full justify-start gap-3 px-3 py-3 h-auto"
                                    >
                                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                        <Icon
                                          name="heading"
                                          className="w-5 h-5 text-gray-700"
                                        />
                                      </div>
                                      <div className="text-left">
                                        <div className="text-sm font-semibold text-gray-900">
                                          Heading
                                        </div>
                                        <div className="text-xs text-gray-500">
                                          Title text
                                        </div>
                                      </div>
                                    </Button>

                                    <Button
                                      onClick={() => {
                                        // Always add inside Body container
                                        const result = addLayerFromTemplate(
                                          currentPageId,
                                          "body",
                                          "text",
                                        );
                                        if (result && liveLayerUpdates) {
                                          // Get FRESH state and find actual parent
                                          const freshDraft =
                                            usePagesStore.getState()
                                              .draftsByPageId[currentPageId];
                                          if (freshDraft) {
                                            const findLayerWithParent = (
                                              layers: Layer[],
                                              id: string,
                                              parent: Layer | null = null,
                                            ): {
                                              layer: Layer;
                                              parent: Layer | null;
                                            } | null => {
                                              for (const l of layers) {
                                                if (l.id === id)
                                                  return { layer: l, parent };
                                                if (l.children) {
                                                  const found =
                                                    findLayerWithParent(
                                                      l.children,
                                                      id,
                                                      l,
                                                    );
                                                  if (found) return found;
                                                }
                                              }
                                              return null;
                                            };
                                            const found = findLayerWithParent(
                                              freshDraft.layers,
                                              result.newLayerId,
                                            );
                                            if (found?.layer) {
                                              const actualParentId =
                                                found.parent?.id || null;
                                              liveLayerUpdates.broadcastLayerAdd(
                                                currentPageId,
                                                actualParentId,
                                                "text",
                                                found.layer,
                                              );
                                            }
                                          }
                                        }
                                        setShowAddBlockPanel(false);
                                      }}
                                      variant="ghost"
                                      className="w-full justify-start gap-3 px-3 py-3 h-auto"
                                    >
                                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                                        <Icon
                                          name="type"
                                          className="w-5 h-5 text-gray-700"
                                        />
                                      </div>
                                      <div className="text-left">
                                        <div className="text-sm font-semibold text-gray-900">
                                          Paragraph
                                        </div>
                                        <div className="text-xs text-gray-500">
                                          Body text
                                        </div>
                                      </div>
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Preview panel - fixed overlay covering sidebars + canvas below the main header.
          Always rendered so the iframe stays mounted (no reload on toggle). */}
      <div
        className="flex flex-col bg-neutral-50 dark:bg-neutral-950"
        style={{
          position: "fixed",
          top: "3.5rem", // h-14 header height
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          display: isPreviewMode ? "flex" : "none",
        }}
      >
        {/* Preview toolbar */}
        <div className="shrink-0 grid grid-cols-3 items-center p-4 border-b bg-background">
          <div />
          <ViewportZoomControls
            viewportMode={viewportMode}
            zoom={previewZoom}
            onViewportChange={setViewportMode}
            onZoomIn={previewZoomIn}
            onZoomOut={previewZoomOut}
            onResetZoom={previewResetZoom}
            onZoomToFit={previewZoomToFit}
            onAutofit={previewAutofit}
          />
          <div className="flex justify-end">
            {previewUrl && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => window.open(previewUrl, "_blank")}
              >
                Open in new tab
                <Icon name="external-link" />
              </Button>
            )}
          </div>
        </div>

        {/* Preview iframe area */}
        <div
          ref={previewContainerRef}
          className="flex-1 relative flex items-start overflow-x-auto overflow-y-hidden"
          style={{ padding: `${CANVAS_BORDER}px` }}
        >
          {isPreviewLoading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background">
              <Spinner />
            </div>
          )}
          {/* Sizer: occupies the SCALED footprint so centering and scrolling
              match the visible preview size. */}
          <div
            className="bg-white shadow-3xl relative mx-auto my-auto"
            style={{
              width: `${previewStageWidth * (previewZoom / 100)}px`,
              height:
                finalPreviewIframeHeight > 0
                  ? `${finalPreviewIframeHeight * (previewZoom / 100)}px`
                  : "100%",
              flexShrink: 0,
            }}
          >
            {/* Stage: natural (unscaled) size, scaled with `transform` instead of
                CSS `zoom`. Safari shrinks an iframe's content viewport under an
                ancestor `zoom`, which rendered previews too narrow; transform keeps
                the iframe at its true breakpoint width. */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: `${previewStageWidth}px`,
                height:
                  finalPreviewIframeHeight > 0
                    ? `${finalPreviewIframeHeight}px`
                    : "100%",
                transform: `scale(${previewZoom / 100})`,
                transformOrigin: "top left",
                transition: "none",
              }}
            >
              {layers.length > 0 && isPreviewMode ? (
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
                  className="w-full h-full border-0"
                  title="Preview"
                  tabIndex={-1}
                  onLoad={handlePreviewLoad}
                />
              ) : layers.length === 0 && isPreviewMode ? (
                <div className="w-full h-full flex items-center justify-center p-12">
                  <div className="text-center max-w-md">
                    <div className="w-20 h-20 bg-linear-to-br from-blue-100 to-blue-50 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                      <Icon name="layout" className="w-10 h-10 text-blue-500" />
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 mb-3">
                      No content
                    </h2>
                    <p className="text-gray-600">
                      This page has no content to preview.
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Rich text sheet for canvas double-click on layers with components/variables */}
      {/* {richTextSheetValue && (
        <RichTextEditorSheet
          open={!!richTextSheetLayerId}
          onOpenChange={(open) => {
            if (!open) {
              flushRichTextTranslationSave();
              closeRichTextSheet();
            }
          }}
          title="Content editor"
          description={richTextTranslationContext && selectedLocale
            ? `Translate to ${selectedLocale.label}`
            : 'Element content'}
          value={richTextSheetValue}
          onChange={handleRichTextSheetChange}
          fieldGroups={richTextSheetFieldGroups}
          allFields={collectionFieldsFromStore}
          collections={collectionsFromStore}
        />
      )} */}
    </div>
  );
});
export default EditorCenterCanvas;
