import { createFileRoute } from "@tanstack/react-router";
import { BananaHorrorGame } from "@/components/BananaHorrorGame";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "髪の生えたばなな追想曲 — Banana Horror" },
      {
        name: "description",
        content:
          "ポップで不気味な2Dホラー。りんごを5つ集めて、髪の生えたバナナから逃げ延びろ。WebAudio合成によるサウンドスケープ。",
      },
      { property: "og:title", content: "髪の生えたばなな追想曲" },
      {
        property: "og:description",
        content: "りんごを5つ集めて脱出するポップ・ホラーゲーム",
      },
    ],
  }),
});

function Index() {
  return <BananaHorrorGame />;
}
