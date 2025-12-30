import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User } from 'lucide-react';
import { sendAgentMessage } from '../lib/api';

import type { ApiResponse } from '../lib/agent-types';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    data?: ApiResponse; // For action inspector
}

interface ChatInterfaceProps {
    onActionReceived: (data: ApiResponse) => void;
    selectedTeamId: string;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({ onActionReceived, selectedTeamId }) => {
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [messages]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setIsLoading(true);

        try {
            const history = messages
                .slice(-20)
                .map((msg) => ({ role: msg.role, content: msg.content }));
            const response = await sendAgentMessage(userMsg.content, selectedTeamId, history);
            const isActionPlan =
                response?.status === 'pending' &&
                typeof response?.agent?.action === 'string' &&
                response.agent.action !== 'error' &&
                response.agent.action !== 'message';

            const botMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response.agent.message || "I've prepared a plan. Please review it in the inspector.",
                ...(isActionPlan ? { data: response } : {})
            };

            setMessages(prev => [...prev, botMsg]);
            if (isActionPlan) {
                onActionReceived(response);
            }

        } catch (error) {
            console.error("Chat Error:", error);
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: "Sorry, I encountered an error processing your request."
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full min-h-0 bg-slate-900 rounded-xl overflow-hidden shadow-2xl border border-slate-700">
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {messages.length === 0 && (
                    <div className="text-center text-slate-500 mt-10">
                        <Bot className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>Hello! I'm your Linear Agent.</p>
                        <p className="text-sm">Ask me to create issues, projects, or upload a file.</p>
                    </div>
                )}

                {messages.map((msg) => (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-lg p-3 ${msg.role === 'user'
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-700 text-slate-200'
                            }`}>
                            <div className="flex items-center gap-2 mb-1 opacity-70 text-xs">
                                {msg.role === 'user' ? <User size={12} /> : <Bot size={12} />}
                                <span>{msg.role === 'user' ? 'You' : 'Agent'}</span>
                            </div>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-slate-700 rounded-lg p-3 animate-pulse">
                            <span className="text-slate-400 text-sm">Thinking...</span>
                        </div>
                    </div>
                )}
                <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="p-4 border-t border-slate-700 bg-slate-800">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type your request (e.g. 'Create a bug for Login UI')..."
                        className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 transition-colors"
                        title="Send Message"
                    >
                        <Send size={20} />
                    </button>
                </div>
            </form>
        </div>
    );
};
