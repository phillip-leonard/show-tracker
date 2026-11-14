'use client';

// components/heard/PosterShare.jsx
//
// Drawing, saving and sharing a server-drawn poster (POST /api/my-poster),
// and making its /p/<code>/ share link. Used by the personal posters
// (MyPosterView.jsx, which posts { record }) and the Year in Review recap
// card (yearInReview/YearRecapView.jsx, which posts { recap, buddyUid }).
// Both need the user's ID token.
//
// Safari (and the iOS app's WebView) refuse the share sheet once an await
// has gone by since the tap, so both images are fetched ahead and the
// link is made in one tap and shared in the next, as /heard/ does.

import React, { useEffect, useState } from 'react';
import { Download, Share2, Link2, Sparkles, Copy } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { apiUrl, apiErrorMessage } from '@/lib/api';
import { isNativePlatform } from '@/lib/platform';
import { Button } from '@/components/ui';

export const POSTER_KINDS = [['feed', 'Feed, 1080×1350'], ['story', 'Story, 1080×1920']];

// What to tell someone when a poster request fails: the limits (429),
// size (413), sign-in (401) and a bad request (400) get their own words.
function posterError(e, fallback) {
  if (!e || !e.status) return fallback;
  return apiErrorMessage({ status: e.status }, e.data, fallback, {
    rateLimited: 'You’ve made a lot of posters today. Try again tomorrow.',
  });
}

export async function postPoster(body) {
  const user = auth.currentUser;
  if (!user) throw new Error('signed out');
  const token = await user.getIdToken();
  const res = await fetch(apiUrl('/api/my-poster'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return res;
}

/**
 * The two images, drawn on request, each with Download (web) and Share /
 * Save or share (where the share sheet takes files).
 *   request    what to post besides action and kind ({ record } / { recap, … })
 *   requestKey changes when the request does, to throw away old images
 *   fileBase   "goose-songs-heard" -> goose-songs-heard-feed.png
 *   shareTitle the share sheet's title
 *   alt        the image's alt text, before ", Feed, 1080×1350"
 */
export function PosterImages({ request, requestKey, fileBase, shareTitle, alt, drawLabel = 'Make my poster', drawingLabel = 'Drawing your poster…' }) {
  const native = isNativePlatform();
  const [state, setState] = useState({ status: 'idle' }); // idle | drawing | ready | error

  // A new request (a show added elsewhere) needs new images.
  useEffect(() => {
    setState((s) => {
      if (s.status === 'ready') s.posters.forEach((p) => URL.revokeObjectURL(p.url));
      return { status: 'idle' };
    });
  }, [requestKey]);

  const draw = async () => {
    setState({ status: 'drawing' });
    try {
      const blobs = await Promise.all(POSTER_KINDS.map(([kind]) => postPoster({ ...request, action: 'image', kind }).then((r) => r.blob())));
      const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare && typeof File !== 'undefined';
      const posters = POSTER_KINDS.map(([kind, label], i) => {
        const file = typeof File !== 'undefined' ? new File([blobs[i]], `${fileBase}-${kind}.png`, { type: 'image/png' }) : null;
        return { kind, label, blob: blobs[i], file, url: URL.createObjectURL(blobs[i]), shareable: !!file && canShareFiles && navigator.canShare({ files: [file] }) };
      });
      setState({ status: 'ready', posters });
    } catch (e) {
      setState({ status: 'error', message: posterError(e, 'Couldn’t draw that just now. Please try again.') });
    }
  };

  const download = (p) => {
    const a = document.createElement('a');
    a.href = p.url;
    a.download = p.file?.name || `${fileBase}-${p.kind}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const share = (p) => {
    navigator.share({ files: [p.file], title: shareTitle })
      .catch((e) => { if (!native && (!e || e.name !== 'AbortError')) download(p); });
  };

  return (
    <div>
      {state.status !== 'ready' && (
        <Button icon={Sparkles} onClick={draw} loading={state.status === 'drawing'}>
          {state.status === 'drawing' ? drawingLabel : drawLabel}
        </Button>
      )}
      {state.status === 'error' && <p className="text-sm text-danger mt-2">{state.message}</p>}
      {state.status === 'ready' && (
        <div className="grid grid-cols-2 gap-3">
          {state.posters.map((p) => (
            <figure key={p.kind} className="m-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`${alt}, ${p.label}`} className="w-full rounded-xl border border-subtle bg-[#1f1f3a]" />
              <figcaption className="text-xs text-muted my-1.5">{p.label}</figcaption>
              <div className="flex flex-wrap gap-2">
                {/* The app's WebView can't save a download; its share sheet has Save Image. */}
                {!native && <Button size="sm" icon={Download} onClick={() => download(p)}>Download</Button>}
                {p.shareable && (
                  <Button size="sm" variant={native ? 'primary' : 'secondary'} icon={Share2} onClick={() => share(p)}>
                    {native ? 'Save or share' : 'Share'}
                  </Button>
                )}
              </div>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Get a share link": stores the request's record under a /p/<code>/ link. */
export function PosterShareLink({ request, requestKey, title, note }) {
  const [state, setState] = useState({ status: 'idle' }); // idle | saving | ready | error
  const [said, setSaid] = useState('');

  useEffect(() => { setState({ status: 'idle' }); setSaid(''); }, [requestKey]);

  const make = async () => {
    setState({ status: 'saving' });
    try {
      const json = await (await postPoster({ ...request, action: 'share' })).json();
      if (!json.url) throw new Error('no url');
      setState({ status: 'ready', url: json.url });
    } catch (e) {
      setState({ status: 'error', message: posterError(e, 'Couldn’t make a link just now. Please try again.') });
    }
  };

  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const shareIt = () => navigator.share({ title, url: state.url }).catch(() => {});
  const copy = () => {
    if (!navigator.clipboard) { setSaid('Copy the link above to share it.'); return; }
    navigator.clipboard.writeText(state.url).then(() => setSaid('Link copied.'), () => setSaid('Copy the link above to share it.'));
  };

  if (state.status !== 'ready') {
    return (
      <div>
        <Button variant="secondary" icon={Link2} onClick={make} loading={state.status === 'saving'}>Get a share link</Button>
        {note && <p className="text-xs text-muted mt-2">{note}</p>}
        {state.status === 'error' && <p className="text-sm text-danger mt-2">{state.message}</p>}
      </div>
    );
  }
  return (
    <div>
      <input
        type="text"
        readOnly
        value={state.url}
        aria-label="Share link"
        onFocus={(e) => e.target.select()}
        className="w-full px-3 py-2 rounded-xl border border-subtle bg-hover text-primary text-sm"
      />
      <div className="flex flex-wrap gap-2 mt-2">
        {canShare && <Button size="sm" icon={Share2} onClick={shareIt}>Share link</Button>}
        <Button size="sm" variant="secondary" icon={Copy} onClick={copy}>Copy link</Button>
      </div>
      {said && <p className="text-xs text-muted mt-2" aria-live="polite">{said}</p>}
    </div>
  );
}
