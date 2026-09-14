import { MobileMenu } from "./mobile-menu";
import { MainNavServer } from "./main-nav-server";

/**
 * Server wrapper for the mobile drawer. Pulls in the same nav children
 * the desktop header renders (MainNavServer fetches counts).
 * Admin is reached from the avatar menu.
 */
export async function MobileMenuServer() {
  return (
    <MobileMenu>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <MainNavServer variant="drawer" />
        </div>
      </div>
    </MobileMenu>
  );
}
