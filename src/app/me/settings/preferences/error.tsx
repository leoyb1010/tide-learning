"use client";

import { EmptyTide } from "@/components/TideIllustration";
import { Button } from "@/components/ui";

/** 偏好设置加载出错的兜底页：友好中文提示 + 重试（reset 重挂路由段）。 */
export default function PreferencesSettingsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <EmptyTide
        variant="offline"
        description="偏好设置加载遇到问题，退潮后请重试。若持续出现可稍后再来。"
        action={
          <Button onClick={reset} variant="primary" size="lg">
            重试
          </Button>
        }
      />
    </div>
  );
}
