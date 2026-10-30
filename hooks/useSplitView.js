// hooks/useSplitView.js
//
// Whether a list screen should show its list beside the open item: native
// app only, and only while the content column is at least
// SPLIT_VIEW_MIN_WIDTH wide (lib/platform.js, hooks/useContentColumnWidth.js).

'use client';

import useContentColumnWidth from '@/hooks/useContentColumnWidth';
import { SPLIT_VIEW_MIN_WIDTH } from '@/lib/platform';

export default function useSplitView() {
  return useContentColumnWidth() >= SPLIT_VIEW_MIN_WIDTH;
}
