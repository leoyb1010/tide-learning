import { redirect } from "next/navigation";

/** 设置根路由：重定向到第一项「个人资料」。真分页架构由 layout + 各子路由承载。 */
export default function SettingsIndexPage() {
  redirect("/me/settings/profile");
}
