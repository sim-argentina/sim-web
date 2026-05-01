type NewsCardProps = {
  title: string;
  date: string;
  description: string;
};

export default function NewsCard({
  title,
  date,
  description,
}: NewsCardProps) {
  return (
    <article className="rounded-[28px] border border-white/10 bg-zinc-950 p-6">
      <div className="text-xs font-bold uppercase tracking-[0.25em] text-red-500">
        {date}
      </div>
      <h3 className="mt-3 text-2xl font-black text-white">{title}</h3>
      <p className="mt-3 leading-7 text-zinc-400">{description}</p>
    </article>
  );
}