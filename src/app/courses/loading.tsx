import { CardSkeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-8 w-40" />
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
      </div>
    </div>
  );
}
