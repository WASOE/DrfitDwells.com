/**
 * Drift & Dwells guest FAQ chat.
 * Valley design system: Montserrat, editorial spacing, sage accent.
 */

import { useState, useRef, useEffect } from 'react';
import './ChatWidget.css';

const WHATSAPP_LINK = 'https://wa.me/359876342540';

const ChatWidget = ({ onClose, propertyContext = null }) => {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I'm here to help with questions about The Cabin, The Valley, access, amenities, and more. Ask away—or I can connect you with our host on WhatsApp for anything personal.", suggestWhatsApp: false },
  ]);
  const [feedbackGiven, setFeedbackGiven] = useState(new Set());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendFeedback = async (messageIndex, rating, m) => {
    try {
      await fetch('/api/chat/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: m.feedbackQuery,
          rating,
          matchedId: m.matchedId,
          messageIndex,
          answerText: m.content,
          top3: m.top3,
          propertyDetected: m.propertyDetected,
          embeddingReady: m.embeddingReady,
        }),
      });
    } catch {
      // Non-fatal
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, propertyContext: propertyContext || undefined }),
      });
      const data = await res.json();

      if (data.answer) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.answer,
            suggestWhatsApp: data.suggestWhatsApp || false,
            feedbackQuery: text,
            matchedId: data.matchedId,
            top3: data.top3,
            propertyDetected: data.propertyDetected,
            embeddingReady: data.embeddingReady,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.message || data.clarifyingQuestion || "I'd love to help with that personally. Reach me on WhatsApp and I'll get back to you.",
            suggestWhatsApp: true,
            feedbackQuery: text,
            matchedId: data.matchedId,
            top3: data.top3,
            propertyDetected: data.propertyDetected,
            embeddingReady: data.embeddingReady,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: "Something went wrong. Reach me on WhatsApp and I'll help you directly.",
          suggestWhatsApp: true,
          feedbackQuery: text,
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  if (!open) return null;

  return (
    <div
      className="chat-widget chat-widget-panel fixed bottom-6 right-6 md:bottom-8 md:right-8 z-[9998] flex flex-col w-[min(100vw-2rem,380px)] max-w-[380px] max-h-[min(85vh,520px)] rounded-xl border border-[rgba(0,0,0,0.12)] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.08)] overflow-hidden"
    >
      {/* Header — Montserrat, lowercase, tracking */}
      <div className="flex items-center justify-between px-5 py-4 bg-[#81887A] text-white border-b border-white/10">
        <span className="chat-widget-header">questions? ask here</span>
        <button
          type="button"
          onClick={handleClose}
          className="p-1.5 rounded-sm hover:bg-white/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label="Close chat"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Messages — valley-body typography */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5 min-h-[200px] max-h-[320px] bg-white">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[88%] rounded-lg px-4 py-3 chat-widget-body ${
                m.role === 'user'
                  ? 'bg-[#81887A] text-white'
                  : 'bg-[rgba(0,0,0,0.02)] text-[#2a2a2a] border border-[rgba(0,0,0,0.08)]'
              }`}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.suggestWhatsApp && (
                <a
                  href={WHATSAPP_LINK}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-[#25D366] font-medium border-b border-[#25D366]/50 hover:border-[#25D366] transition-colors pb-0.5"
                >
                  <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.865 9.865 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  chat on whatsapp
                </a>
              )}
              {m.role === 'assistant' && m.feedbackQuery && (
                <div className="mt-2 flex items-center gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-[#6a6a6a] mr-1">helpful?</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (feedbackGiven.has(i)) return;
                      setFeedbackGiven((prev) => new Set(prev).add(i));
                      sendFeedback(i, 'up', m);
                    }}
                    disabled={feedbackGiven.has(i)}
                    className={`p-1 rounded ${feedbackGiven.has(i) ? 'opacity-50 cursor-default' : 'hover:bg-[rgba(0,0,0,0.06)]'} transition-colors`}
                    aria-label="Helpful"
                  >
                    <svg className="w-4 h-4 text-[#4a4a4a]" fill={feedbackGiven.has(i) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (feedbackGiven.has(i)) return;
                      setFeedbackGiven((prev) => new Set(prev).add(i));
                      sendFeedback(i, 'down', m);
                    }}
                    disabled={feedbackGiven.has(i)}
                    className={`p-1 rounded ${feedbackGiven.has(i) ? 'opacity-50 cursor-default' : 'hover:bg-[rgba(0,0,0,0.06)]'} transition-colors`}
                    aria-label="Not helpful"
                  >
                    <svg className="w-4 h-4 text-[#4a4a4a]" fill={feedbackGiven.has(i) ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06l3.76.94m-7 10v5a2 2 0 002 2h.096c.5 0 .905-.405.905-.904 0-.715.211-1.413.608-2.008L17 13V4m-7 10h2M5 5a2 2 0 002 2h2a2 2 0 002-2 2 2 0 00-2-2H7a2 2 0 00-2 2z" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-[rgba(0,0,0,0.02)] border border-[rgba(0,0,0,0.08)] rounded-lg px-4 py-3">
              <span className="inline-flex gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#81887A]/50 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-[#81887A]/50 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-[#81887A]/50 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input — editorial border-b style */}
      <div className="p-4 border-t border-[rgba(0,0,0,0.12)] bg-white">
        <div className="flex gap-3 items-end">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="access, amenities, hot tub..."
            className="chat-widget-input flex-1 px-0 py-3 border-0 border-b border-[rgba(0,0,0,0.12)] bg-transparent text-[#1a1a1a] placeholder:text-[#6a6a6a] focus:outline-none focus:border-[#81887A] transition-colors"
            disabled={loading}
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="chat-widget-btn px-5 py-3 rounded-full bg-[#81887A] text-white hover:bg-[#6d7366] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#81887A] transition-colors flex-shrink-0"
          >
            send
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatWidget;
