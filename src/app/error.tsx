"use client";

import { EmptyTide } from "@/components/TideIllustration";
import { Button } from "@/components/ui";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <EmptyTide
        variant="offline"
        description="页面加载遇到问题，退潮后请重试。若持续出现可稍后再来。"
        action={
          <Button onClick={reset} variant="primary" size="lg">
            重试
          </Button>
        }
      />
    </div>
  );
}
