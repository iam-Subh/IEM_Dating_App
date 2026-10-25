import { useCallback, useMemo, useRef, useState } from 'react';
import type { DrawingStroke, Layer, StoryDraftItem } from './types';

const HISTORY_LIMIT = 40;

type Updater<T> = Partial<T> | ((current: T) => Partial<T>);

/**
 * The stories open in the editor, the one being edited, and undo.
 *
 * Undo steps back through whole-item snapshots. A gesture that changes a layer
 * continuously (a drag, a pinch) records one step when it starts, not one per
 * frame, by passing `record: false` while it moves.
 */
export function useStoryEditor(initial: StoryDraftItem[]) {
  const [items, setItems] = useState<StoryDraftItem[]>(initial);
  const startingItems = useRef(initial);
  const [index, setIndex] = useState(0);
  const history = useRef(new Map<string, StoryDraftItem[]>());
  const [historyVersion, setHistoryVersion] = useState(0);

  const current = items[Math.min(index, items.length - 1)];

  const record = useCallback((item: StoryDraftItem) => {
    const stack = history.current.get(item.id) ?? [];
    stack.push(item);
    if (stack.length > HISTORY_LIMIT) stack.shift();
    history.current.set(item.id, stack);
    setHistoryVersion((value) => value + 1);
  }, []);

  const updateItem = useCallback((itemId: string, change: Updater<StoryDraftItem>, options: { record?: boolean } = {}) => {
    setItems((list) => list.map((item) => {
      if (item.id !== itemId) return item;
      if (options.record !== false) record(item);
      return { ...item, ...(typeof change === 'function' ? change(item) : change) };
    }));
  }, [record]);

  const updateCurrent = useCallback((change: Updater<StoryDraftItem>, options?: { record?: boolean }) => {
    if (current) updateItem(current.id, change, options);
  }, [current, updateItem]);

  const addLayer = useCallback((layer: Layer) => {
    updateCurrent((item) => ({ layers: [...item.layers, layer] }));
  }, [updateCurrent]);

  const updateLayer = useCallback((layerId: string, change: Updater<Layer>, options?: { record?: boolean }) => {
    updateCurrent((item) => ({
      layers: item.layers.map((layer) => (layer.id === layerId
        ? ({ ...layer, ...(typeof change === 'function' ? change(layer) : change) } as Layer)
        : layer)),
    }), options);
  }, [updateCurrent]);

  const removeLayer = useCallback((layerId: string) => {
    updateCurrent((item) => ({ layers: item.layers.filter((layer) => layer.id !== layerId) }));
  }, [updateCurrent]);

  /** The layer being moved comes to the front, as on Instagram. */
  const bringToFront = useCallback((layerId: string) => {
    updateCurrent((item) => {
      const layer = item.layers.find((entry) => entry.id === layerId);
      if (!layer || item.layers[item.layers.length - 1]?.id === layerId) return {};
      return { layers: [...item.layers.filter((entry) => entry.id !== layerId), layer] };
    }, { record: false });
  }, [updateCurrent]);

  const addStroke = useCallback((stroke: DrawingStroke) => {
    updateCurrent((item) => ({ drawing: [...item.drawing, stroke] }));
  }, [updateCurrent]);

  const undo = useCallback(() => {
    if (!current) return;
    const stack = history.current.get(current.id);
    const previous = stack?.pop();
    if (!previous) return;
    setItems((list) => list.map((item) => (item.id === current.id ? previous : item)));
    setHistoryVersion((value) => value + 1);
  }, [current]);

  const canUndo = useMemo(() => Boolean(current && history.current.get(current.id)?.length), [current, historyVersion]);

  const canReset = Boolean(current && startingItems.current.some(item => item.id === current.id && item !== current));
  const resetCurrent = useCallback(() => {
    if (!current) return;
    const starting = startingItems.current.find(item => item.id === current.id);
    if (!starting || starting === current) return;
    record(current);
    setItems(list => list.map(item => item.id === current.id ? starting : item));
  }, [current, record]);

  const removeItem = useCallback((itemId: string) => {
    setItems((list) => {
      const next = list.filter((item) => item.id !== itemId);
      setIndex((value) => Math.max(0, Math.min(value, next.length - 1)));
      return next;
    });
    history.current.delete(itemId);
  }, []);

  return {
    items, setItems, index, setIndex, current,
    updateItem, updateCurrent, addLayer, updateLayer, removeLayer, bringToFront, addStroke,
    undo, canUndo, resetCurrent, canReset, removeItem,
  };
}

export type StoryEditor = ReturnType<typeof useStoryEditor>;
