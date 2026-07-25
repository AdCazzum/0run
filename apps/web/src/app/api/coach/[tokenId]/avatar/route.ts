import { eq } from "drizzle-orm";
import { db } from "@/db";
import { coaches } from "@/db/schema";

/**
 * A coach's avatar, as an image.
 *
 * Public and unauthenticated: it is shown next to the coach's name everywhere,
 * including to people who are not signed in. It is served as bytes rather than
 * embedded in the pages so a 120KB PNG is fetched once and cached by the
 * browser, instead of being re-sent inside the HTML of every listing.
 *
 * An absent avatar is a 404, not a placeholder image: the UI draws its own
 * fallback from the coach's initial, which stays readable and on-brand where a
 * broken-image icon would not.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ tokenId: string }> }) {
  const { tokenId } = await ctx.params;

  const [row] = await db
    .select({ avatarImage: coaches.avatarImage })
    .from(coaches)
    .where(eq(coaches.tokenId, tokenId));

  if (!row?.avatarImage) {
    return new Response("no avatar for this coach", { status: 404 });
  }

  const bytes = Buffer.from(row.avatarImage, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/png",
      "content-length": String(bytes.length),
      // The image is generated once and never changes for a given coach, so it
      // can be cached hard. `immutable` is honest here in a way it rarely is.
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
