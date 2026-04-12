import { useEffect, useMemo, useState } from "react";

interface ImpactCardShareProps {
  mode: "donor" | "organizer";
  campaignTitle: string;
  ngoName: string;
  shareUrl: string;
  amountLabel?: string | null;
  txHash?: string | null;
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 3
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let truncated = false;

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word);
      current = "";
    }

    if (lines.length === maxLines - 1) {
      current = next;
      truncated = true;
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (truncated && lines.length > 0) {
    let lastLine = lines[lines.length - 1];
    while (ctx.measureText(`${lastLine}...`).width > maxWidth && lastLine.includes(" ")) {
      lastLine = lastLine.replace(/\s+\S*$/, "");
    }
    lines[lines.length - 1] = `${lastLine.replace(/\s+\S*$/, "") || lastLine}...`;
  }

  return lines.slice(0, maxLines);
}

function dataUrlToFile(dataUrl: string, filename: string) {
  const [meta, content] = dataUrl.split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/);
  const mime = mimeMatch?.[1] || "image/png";
  const bytes = atob(content);
  const array = new Uint8Array(bytes.length);

  for (let i = 0; i < bytes.length; i += 1) {
    array[i] = bytes.charCodeAt(i);
  }

  return new File([array], filename, { type: mime });
}

async function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

export default function ImpactCardShare({
  mode,
  campaignTitle,
  ngoName,
  shareUrl,
  amountLabel,
  txHash,
}: ImpactCardShareProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  const copy = useMemo(() => {
    if (mode === "organizer") {
      return {
        eyebrow: "Campaign Completed",
        headline: "We just completed this campaign on-chain.",
        kicker: "Milestones verified. Funds released transparently.",
        badge: "Organizer update",
      };
    }

    return {
      eyebrow: "Impact Backed",
      headline: "I just backed this campaign on-chain.",
      kicker: "Donation locked in milestone-based escrow on VeraFund.",
      badge: amountLabel ? `Donated ${amountLabel}` : "On-chain donation",
    };
  }, [amountLabel, mode]);

  const xShareText = useMemo(() => {
    if (mode === "organizer") {
      return `We just completed "${campaignTitle}" on VeraFund. Transparent milestones, on-chain escrow, and verified impact.`;
    }

    return `I just backed "${campaignTitle}" on VeraFund. Transparent donation escrow, milestone verification, and on-chain accountability.`;
  }, [campaignTitle, mode]);

  useEffect(() => {
    let cancelled = false;

    async function renderCard() {
      try {
        const W = 1600;
        const H = 900;
        const PAD = 86;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");

        if (!ctx) return;

        // Background
        ctx.fillStyle = "#f3f3f3";
        ctx.fillRect(0, 0, W, H);

        // Grid lines
        ctx.fillStyle = "#d6d6d6";
        for (let x = 0; x < W; x += 160) {
          ctx.fillRect(x, 0, 2, H);
        }
        for (let y = 0; y < H; y += 160) {
          ctx.fillRect(0, y, W, 2);
        }

        // Yellow accent bar (right edge, inside border)
        ctx.fillStyle = "#e2e800";
        ctx.fillRect(W - 44, 18, 26, H - 36);

        // Outer border
        ctx.strokeStyle = "#141414";
        ctx.lineWidth = 6;
        ctx.strokeRect(18, 18, W - 36, H - 36);

        let cursorY = 70;

        // Logo + brand name
        const logo = await loadImage("/veraFundLogo.png").catch(() => null);
        if (logo) {
          ctx.fillStyle = "#7ea5ff";
          ctx.strokeStyle = "#141414";
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.roundRect(PAD, cursorY, 80, 80, 18);
          ctx.fill();
          ctx.stroke();
          ctx.drawImage(logo, PAD + 12, cursorY + 12, 56, 56);
        }
        ctx.fillStyle = "#141414";
        ctx.font = "700 38px Arial";
        ctx.fillText("VeraFund", PAD + 96, cursorY + 52);

        cursorY += 110;

        // Eyebrow
        ctx.fillStyle = "#444444";
        ctx.font = "700 24px Arial";
        ctx.fillText(copy.eyebrow.toUpperCase(), PAD, cursorY);

        cursorY += 20;

        // Headline — measure first, then draw yellow highlight behind it
        ctx.font = "900 72px Arial";
        const headlineLines = wrapText(ctx, copy.headline, W - PAD * 2 - 80, 2);
        const headlineLineHeight = 82;
        const headlineBlockHeight = headlineLines.length * headlineLineHeight + 24;

        // Yellow highlight box (slightly rotated)
        ctx.fillStyle = "#e2e800";
        ctx.strokeStyle = "#141414";
        ctx.lineWidth = 5;
        ctx.save();
        ctx.translate(PAD - 6, cursorY - 2);
        ctx.rotate(-0.015);
        const highlightWidth = Math.min(
          headlineLines.reduce((max, line) => Math.max(max, ctx.measureText(line).width), 0) + 40,
          W - PAD * 2
        );
        ctx.fillRect(0, 0, highlightWidth, headlineBlockHeight);
        ctx.strokeRect(0, 0, highlightWidth, headlineBlockHeight);
        ctx.restore();

        // Draw headline text
        ctx.fillStyle = "#141414";
        ctx.font = "900 72px Arial";
        headlineLines.forEach((line, index) => {
          ctx.fillText(line, PAD + 6, cursorY + 62 + index * headlineLineHeight);
        });

        cursorY += headlineBlockHeight + 24;

        // Kicker box
        ctx.font = "600 30px Arial";
        const kickerLines = wrapText(ctx, copy.kicker, W - PAD * 2 - 120, 3);
        const kickerLineHeight = 38;
        const kickerBoxHeight = kickerLines.length * kickerLineHeight + 40;

        ctx.fillStyle = "#faf5ea";
        ctx.strokeStyle = "#141414";
        ctx.lineWidth = 4;
        ctx.fillRect(PAD, cursorY, W - PAD * 2 - 60, kickerBoxHeight);
        ctx.strokeRect(PAD, cursorY, W - PAD * 2 - 60, kickerBoxHeight);

        ctx.fillStyle = "#141414";
        ctx.font = "600 30px Arial";
        kickerLines.forEach((line, index) => {
          ctx.fillText(line, PAD + 28, cursorY + 36 + index * kickerLineHeight);
        });

        cursorY += kickerBoxHeight + 28;

        // Meta pills
        const metaPills = [
          copy.badge,
          ngoName,
          txHash ? `Tx ${txHash.slice(0, 6)}...${txHash.slice(-4)}` : "",
        ].filter(Boolean);

        let pillX = PAD;
        ctx.font = "700 22px Arial";
        const pillHeight = 52;
        metaPills.forEach((pill, index) => {
          const textWidth = ctx.measureText(pill).width;
          const pillWidth = textWidth + 40;
          ctx.fillStyle = index === 0 ? "#444444" : "#ffffff";
          ctx.strokeStyle = "#141414";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.roundRect(pillX, cursorY, pillWidth, pillHeight, 16);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = index === 0 ? "#ffffff" : "#141414";
          ctx.fillText(pill, pillX + 20, cursorY + 34);
          pillX += pillWidth + 14;
        });

        cursorY += pillHeight + 22;

        // Campaign title at bottom
        ctx.fillStyle = "#141414";
        ctx.font = "600 28px Arial";
        const titleLines = wrapText(ctx, campaignTitle, W - PAD * 2 - 80, 1);
        titleLines.forEach((line, index) => {
          ctx.fillText(line, PAD, cursorY + index * 34);
        });

        if (!cancelled) {
          setImageUrl(canvas.toDataURL("image/png"));
        }
      } catch {
        if (!cancelled) {
          setImageUrl(null);
        }
      }
    }

    renderCard();

    return () => {
      cancelled = true;
    };
  }, [campaignTitle, copy.badge, copy.eyebrow, copy.headline, copy.kicker, ngoName, txHash]);

  const handleDownload = () => {
    if (!imageUrl) return;

    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `${campaignTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-impact-card.png`;
    link.click();
  };

  const handleNativeShare = async () => {
    if (!navigator.share) return;

    setIsSharing(true);
    try {
      if (imageUrl) {
        const file = dataUrlToFile(imageUrl, "verafund-impact-card.png");
        if ("canShare" in navigator && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `VeraFund · ${campaignTitle}`,
            text: xShareText,
            files: [file],
          });
          return;
        }
      }

      await navigator.share({
        title: `VeraFund · ${campaignTitle}`,
        text: xShareText,
        url: shareUrl,
      });
    } finally {
      setIsSharing(false);
    }
  };

  const xIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    xShareText
  )}&url=${encodeURIComponent(shareUrl)}`;

  return (
    <div className="impact-card-shell">
      <div className="impact-card-copy">
        <div className="impact-card-kicker">{copy.eyebrow}</div>
        <h4 className="impact-card-title">
          {mode === "organizer" ? "Share campaign completion" : "Share your impact"}
        </h4>
        <p className="impact-card-description">
          {mode === "organizer"
            ? "Turn the finished campaign into a clean update your supporters can repost."
            : "Turn your donation into a card you can download or post right away."}
        </p>
      </div>

      <div className="impact-card-preview-frame">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={`Impact card for ${campaignTitle}`}
            className="impact-card-preview"
          />
        ) : (
          <div className="impact-card-preview impact-card-preview-loading">Generating card...</div>
        )}
      </div>

      <div className="impact-card-actions">
        <button type="button" className="neo-btn neo-btn-primary" onClick={handleDownload}>
          Download Card
        </button>
        <a
          className="neo-btn neo-btn-outline"
          href={xIntentUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Share on X
        </a>
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button
            type="button"
            className="neo-btn neo-btn-outline"
            onClick={handleNativeShare}
            disabled={isSharing}
          >
            {isSharing ? "Sharing..." : "Share"}
          </button>
        )}
      </div>
    </div>
  );
}
