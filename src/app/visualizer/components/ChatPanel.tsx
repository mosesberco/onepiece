'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { LoaderCircle, Send, Sparkles } from 'lucide-react';
import { askGraphQuestion } from '@/app/actions/chat';
import type { ChatMessage } from '../types';

type Props = {
  characterNameToId: Map<string, string>;
  onMentionClick: (nodeId: string) => void;
};

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    'Ask anything about the story graph. Try: "Who are Luffy\'s closest allies?" or "Which arc introduces Wano?"',
};

export function ChatPanel({ characterNameToId, onMentionClick }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, loading]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setMessages((prev) => [...prev, { id: makeId(), role: 'user', content: q }]);
    setInput('');
    setLoading(true);
    try {
      const res = await askGraphQuestion(q);
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: 'assistant', content: res.answer },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: 'assistant',
          content: `Sorry, I couldn't answer that: ${msg}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            characterNameToId={characterNameToId}
            onMentionClick={onMentionClick}
          />
        ))}
        {loading && (
          <div className="mr-8 flex items-center gap-2 rounded-lg bg-slate-800/60 px-3 py-2 text-xs text-slate-300">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin text-sky-400" />
            Thinking...
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex shrink-0 items-center gap-2 border-t border-slate-800/60 p-3"
      >
        <Sparkles className="h-3.5 w-3.5 text-sky-400" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the story..."
          className="h-9 flex-1 rounded-md border border-slate-800 bg-slate-950/60 px-2.5 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-sky-500/40"
        />
        <button
          type="submit"
          disabled={loading || input.trim().length === 0}
          className="flex h-9 w-9 items-center justify-center rounded-md bg-sky-500 text-slate-950 transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}

function MessageBubble({
  message,
  characterNameToId,
  onMentionClick,
}: {
  message: ChatMessage;
  characterNameToId: Map<string, string>;
  onMentionClick: (nodeId: string) => void;
}) {
  const isUser = message.role === 'user';
  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
        isUser
          ? 'ml-8 bg-sky-500/15 text-sky-100'
          : 'mr-8 bg-slate-800/60 text-slate-100'
      }`}
    >
      {message.role === 'assistant'
        ? renderWithMentions(message.content, characterNameToId, onMentionClick)
        : message.content}
    </div>
  );
}

function renderWithMentions(
  content: string,
  characterNameToId: Map<string, string>,
  onMentionClick: (nodeId: string) => void,
) {
  const pattern = /\[\[([^[\]]+)\]\]/g;
  const parts: Array<string | { mention: string }> = [];
  let cursor = 0;
  for (const match of content.matchAll(pattern)) {
    const full = match[0];
    const mention = match[1];
    const idx = match.index ?? 0;
    if (idx > cursor) parts.push(content.slice(cursor, idx));
    parts.push({ mention });
    cursor = idx + full.length;
  }
  if (cursor < content.length) parts.push(content.slice(cursor));
  if (parts.length === 0) return content;

  return parts.map((part, i) => {
    if (typeof part === 'string') {
      return <span key={i}>{part}</span>;
    }
    const nodeId = characterNameToId.get(part.mention.toLowerCase());
    if (!nodeId) {
      return (
        <span key={i} className="font-medium text-sky-300">
          {part.mention}
        </span>
      );
    }
    return (
      <button
        key={i}
        type="button"
        onClick={() => onMentionClick(nodeId)}
        className="mx-0.5 rounded bg-sky-500/20 px-1 py-0.5 font-medium text-sky-200 hover:bg-sky-500/30"
      >
        {part.mention}
      </button>
    );
  });
}
