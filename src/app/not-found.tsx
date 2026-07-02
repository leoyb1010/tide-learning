import Link from "next/link";
import { EmptyTide } from "@/components/TideIllustration";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <EmptyTide
        variant="notfound"
        description="你要找的内容不存在或已下架，回到首页继续探索每周上新的课程。"
        action={
          <Button href="/" variant="primary" size="lg">
            返回首页
          </Button>
        }
      />
      <p className="mt-6 text-sm text-ink-400">
        或前往
        <Link href="/courses" className="link-underline mx-1 text-accent-700">
          课程库
        </Link>
        看看
      </p>
    </div>
  );
}
