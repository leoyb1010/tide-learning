"use client";

import { EmptyTide } from "@/components/TideIllustration";
import { Button } from "@/components/ui";

/** 收银台加载出错的兜底页：友好中文提示 + 重试（reset 重挂路由段），涉支付场景不误导已扣款。 */
export default function CheckoutError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <EmptyTide
        variant="offline"
        description="收银台加载遇到问题，未产生任何扣款。退潮后请重试，若持续出现可稍后再来。"
        action={
          <Button onClick={reset} variant="primary" size="lg">
            重试
          </Button>
        }
      />
    </div>
  );
}
