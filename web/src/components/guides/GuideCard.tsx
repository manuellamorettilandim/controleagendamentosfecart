import React from "react";

export interface GuideCardProps {
  icon: string;
  iconBgColor?: string;
  iconColor?: string;
  badgeText?: string;
  title: string;
  description: string;
  features: string[];
  illustrationSrc?: string;
  buttonLabel?: string;
  isPrimaryButton?: boolean;
  onOpen: () => void;
}
export function GuideCard({
  icon,
  iconBgColor = "rgba(var(--color-brand-primary-rgb), 0.1)",
  iconColor = "var(--color-brand-primary)",
  badgeText,
  title,
  description,
  features,
  illustrationSrc,
  buttonLabel = "Abrir guia",
  isPrimaryButton = false,
  onOpen,
}: GuideCardProps) {
  return (
    <article className="ui-card ui-card-interactive guide-index-card">
      <div className="guide-index-card-content">
        <div className="guide-index-card-topline">
          <span
            className="guide-index-card-icon"
            style={{ backgroundColor: iconBgColor, color: iconColor }}
          >
            <i className={"ph " + icon} aria-hidden="true" />
          </span>
          {badgeText && (
            <span className="badge badge-success guide-index-card-badge">
              <i className="ph ph-sparkle" aria-hidden="true" />
              {badgeText}
            </span>
          )}
        </div>

        <h3>{title}</h3>
        <p className="guide-index-card-description">{description}</p>

        <div className="guide-index-card-details">
          <div className="guide-index-card-features">
            {features.map((feature) => (
              <div key={feature} className="guide-index-card-feature">
                <i className="ph ph-check-circle-fill" aria-hidden="true" />
                <span>{feature}</span>
              </div>
            ))}
          </div>
          {illustrationSrc && (
            <img className="guide-index-card-illustration" src={illustrationSrc} alt="" loading="lazy" />
          )}
        </div>
      </div>

      <button
        type="button"
        className={"btn " + (isPrimaryButton ? "btn-primary" : "btn-outline-brand") + " guide-index-card-action"}
        onClick={onOpen}
      >
        <span>{buttonLabel}</span>
        <i className="ph ph-arrow-right" aria-hidden="true" />
      </button>
    </article>
  );
}
