const state = {
  chatLog: [],
};

export function Chat(props) {
  const chatLog = state.chatLog.map((entry) => ChatEntry(entry)).join("");

  return `<div class="chat">${chatLog}</div>`;
}

function ChatEntry({ name, datetime, html }) {
  return `<div class="chat-entry">
        <span class="chat-entry-name">${name}</span>
        <span class="chat-entry-datetime">${datetime}</span>
        <span class="chat-entry-html">${html}</span>
    </div>`;
}
