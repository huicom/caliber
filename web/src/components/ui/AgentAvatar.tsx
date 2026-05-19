export function AgentAvatar({ id, size = 40 }: { id: string; size?: number }) {
  const url = `https://api.dicebear.com/9.x/bottts/svg?seed=Agent+${id}`;
  return (
    <img
      src={url}
      width={size}
      height={size}
      alt={`Agent ${id} avatar`}
      className="rounded-md bg-bg-muted shrink-0"
    />
  );
}
