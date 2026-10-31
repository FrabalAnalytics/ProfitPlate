import type { ReactNode } from "react";
import { Brand, Check } from "./brand";

export function AuthShell({
  children,
  step = "YOUR RESTAURANT, CONNECTED",
}: {
  children: ReactNode;
  step?: string;
}) {
  return (
    <div className="auth-layout">
      <aside className="auth-story" aria-label="About ProfitPlate">
        <Brand light />
        <div className="story-body">
          <span className="eyebrow story-eyebrow">
            BUILT FOR THE BUSINESS BEHIND THE FOOD
          </span>
          <h2>
            A little more clarity.
            <br />
            <em>A lot more control.</em>
          </h2>
          <p>
            Bring your people, inventory, and operating decisions into one
            dependable workspace.
          </p>
          <div className="story-illustration" aria-hidden="true">
            <div className="illustration-header">
              <span className="illustration-icon">P.</span>
              <div>
                <strong>A stronger foundation</strong>
                <small>One business. One shared view.</small>
              </div>
              <span className="illustration-live" />
            </div>
            {["Your business", "Your locations", "Your inventory"].map(
              (label, index) => (
                <div className="illustration-row" key={label}>
                  <span className="illustration-number">0{index + 1}</span>
                  <span>{label}</span>
                  <span className="illustration-line" />
                  <Check />
                </div>
              ),
            )}
          </div>
        </div>
        <div className="story-footer">
          <span className="small-square" />
          Good information. Better decisions.
        </div>
      </aside>
      <main id="main" className="auth-main">
        <div className="mobile-brand">
          <Brand />
        </div>
        <div className="auth-form-wrap">
          <p className="eyebrow">{step}</p>
          {children}
        </div>
        <footer className="auth-footer">
          Restaurant inventory &amp; margin intelligence<span>ProfitPlate</span>
        </footer>
      </main>
    </div>
  );
}
