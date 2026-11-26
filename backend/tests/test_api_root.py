import unittest

from app.main import app


class ApiRootTests(unittest.TestCase):
    def test_root_returns_api_status_and_docs_link(self):
        root_route = next(
            route for route in app.routes
            if getattr(route, "path", None) == "/"
        )

        self.assertEqual(
            root_route.endpoint(),
            {
                "service": "AusPlay API",
                "status": "ok",
                "docs": "/docs",
            },
        )


if __name__ == "__main__":
    unittest.main()
