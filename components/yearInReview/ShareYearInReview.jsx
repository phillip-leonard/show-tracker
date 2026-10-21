'use client';

import React, { useState } from 'react';
import { Copy, Twitter, Download, Share2, Check, Mail } from 'lucide-react';
import { Button } from '@/components/ui';

// Draws a shareable 1080x1080 recap card on a <canvas> and resolves a JPEG
// blob — no external image-generation service available in this
// client-only Firebase app, so this mirrors the canvas-resize pattern
// already used for photo compression in lib/utils.js.
function renderShareImage(stats, userName) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d');

  // The app's own palette (app/globals.css): navy ground, and the three
  // counts in the colors they have on the Year in Review page — Shows
  // green, Bands amber, Venues white.
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1080);
  gradient.addColorStop(0, '#2a2a4e');
  gradient.addColorStop(1, '#1f1f3a');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1080);
  ctx.fillStyle = '#10b981';
  ctx.fillRect(0, 0, 1080, 14);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';

  ctx.font = '700 34px -apple-system, sans-serif';
  ctx.globalAlpha = 0.85;
  ctx.fillText('MYSETLISTS', 540, 130);
  ctx.globalAlpha = 1;

  ctx.font = '800 88px -apple-system, sans-serif';
  ctx.fillText(`Your ${stats.year}`, 540, 260);
  ctx.fillText('in Concerts', 540, 355);

  const bigStats = [
    { value: stats.totalShows, label: stats.totalShows === 1 ? 'Show' : 'Shows', color: '#10b981' },
    { value: stats.totalArtists, label: stats.totalArtists === 1 ? 'Band' : 'Bands', color: '#ffb700' },
    { value: stats.totalVenues, label: stats.totalVenues === 1 ? 'Venue' : 'Venues', color: '#f5f5f5' },
  ];
  const startX = 200;
  const gap = 340;
  bigStats.forEach((s, i) => {
    const x = startX + i * gap;
    ctx.font = '800 110px -apple-system, sans-serif';
    ctx.fillStyle = s.color;
    ctx.fillText(String(s.value), x, 560);
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 30px -apple-system, sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText(s.label, x, 605);
    ctx.globalAlpha = 1;
  });

  if (stats.topArtist) {
    ctx.font = '600 28px -apple-system, sans-serif';
    ctx.globalAlpha = 0.8;
    ctx.fillText('TOP BAND', 540, 700);
    ctx.globalAlpha = 1;
    ctx.font = '800 56px -apple-system, sans-serif';
    ctx.fillText(stats.topArtist.name, 540, 760);
    ctx.font = '500 26px -apple-system, sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText(`${stats.topArtist.showCount} shows`, 540, 800);
    ctx.globalAlpha = 1;
  }

  ctx.font = '500 30px -apple-system, sans-serif';
  ctx.globalAlpha = 0.9;
  wrapText(ctx, stats.shareableQuote, 540, 900, 900, 40);
  ctx.globalAlpha = 1;

  ctx.font = '600 24px -apple-system, sans-serif';
  ctx.globalAlpha = 0.75;
  ctx.fillText(userName ? `${userName} · mysetlists.net` : 'mysetlists.net', 540, 1030);
  ctx.globalAlpha = 1;

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = (text || '').split(' ');
  let line = '';
  let curY = y;
  words.forEach((word) => {
    const test = line + word + ' ';
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line.trim(), x, curY);
      line = word + ' ';
      curY += lineHeight;
    } else {
      line = test;
    }
  });
  if (line) ctx.fillText(line.trim(), x, curY);
}

export default function ShareYearInReview({ stats, shareUrl, userName }) {
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy link:', err);
    }
  };

  const handleTwitterShare = () => {
    const text = `${stats.shareableQuote} See my year in concerts:`;
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleEmailShare = () => {
    const subject = `Check out my ${stats.year} concert year!`;
    const body = `${stats.shareableQuote}\n\n${shareUrl}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const handleDownload = async () => {
    setGenerating(true);
    try {
      const blob = await renderShareImage(stats, userName);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-${stats.year}-in-concerts.jpg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to generate share image:', err);
    }
    setGenerating(false);
  };

  const handleNativeShare = async () => {
    setGenerating(true);
    try {
      const blob = await renderShareImage(stats, userName);
      const file = new File([blob], `my-${stats.year}-in-concerts.jpg`, { type: 'image/jpeg' });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `My ${stats.year} in Concerts`, text: stats.shareableQuote });
      } else if (navigator.share) {
        await navigator.share({ title: `My ${stats.year} in Concerts`, text: stats.shareableQuote, url: shareUrl });
      } else {
        await handleDownload();
      }
    } catch (err) {
      if (err?.name !== 'AbortError') console.error('Failed to share:', err);
    }
    setGenerating(false);
  };

  return (
    <div className="flex flex-wrap gap-2.5">
      <Button variant="secondary" icon={copied ? Check : Copy} onClick={handleCopyLink}>
        {copied ? 'Copied!' : 'Copy Link'}
      </Button>
      <Button variant="secondary" icon={Twitter} onClick={handleTwitterShare}>Twitter</Button>
      <Button variant="secondary" icon={Share2} onClick={handleNativeShare} loading={generating}>Share Image</Button>
      <Button variant="secondary" icon={Download} onClick={handleDownload} loading={generating}>Download</Button>
      <Button variant="ghost" icon={Mail} onClick={handleEmailShare}>Email</Button>
    </div>
  );
}
