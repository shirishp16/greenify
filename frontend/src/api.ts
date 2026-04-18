import type { AgentResponse, ChatLogMessage, HomeState } from "./types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function getHomeState(): Promise<HomeState> {
  return request<HomeState>("/api/home-state");
}

export function planAndExecute(goal: string, chatHistory: ChatLogMessage[] = []): Promise<AgentResponse> {
  return request<AgentResponse>("/api/agent/plan-and-execute", {
    method: "POST",
    body: JSON.stringify({ goal, chat_history: chatHistory }),
  });
}

export function toggleDevice(deviceId: string): Promise<HomeState> {
  return request<HomeState>(`/api/device/${encodeURIComponent(deviceId)}/toggle`, {
    method: "POST",
  });
}
