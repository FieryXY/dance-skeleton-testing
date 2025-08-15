import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
    route("/play/:objectId", "game-page/GamePage.tsx"),
    route("level-creation", "level-creation/LevelCreationPage.tsx"),
    route("/", "landing-page/LandingPage.tsx"),
    route("/calibration-page", "calibration-page/CalibrationPage.tsx")
] satisfies RouteConfig;
