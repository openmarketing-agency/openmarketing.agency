"""Check an operator-approved Streamable HTTP MCP endpoint without calling tools."""

from ipaddress import ip_address
import os
import re


class MCPCheckError(Exception):
    pass


def approved_url(value):
    # Exact, operator-owned allowlist. No URL credentials, query tokens, ports,
    # template interpolation, or endpoint discovery from user-controlled redirects.
    if not isinstance(value, str) or len(value) > 2048:
        return ""
    match = re.fullmatch(r"https://([a-z0-9.-]+)(/[A-Za-z0-9._~/-]*)?", value)
    if not match:
        return ""
    hostname = match[1]
    if "." not in hostname or hostname.endswith(".") or hostname.endswith(".localhost"):
        return ""
    try:
        ip_address(hostname)
    except ValueError:
        pass
    else:
        return ""
    if value not in {url.strip() for url in os.getenv("OMA_CUSTOM_MCP_URLS", "").split(",")}:
        return ""
    return value


def check_tools(url, *, transport=None):
    import anyio
    import httpx2
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from tools.mcp_tool_errors import _make_mcp_body_cap_transport

    async def check():
        async def check_response(response):
            if response.has_redirect_location or response.headers.get("content-encoding", "identity").lower() != "identity":
                raise httpx2.RequestError("Custom MCP redirects and compressed responses are not supported.")

        with anyio.fail_after(8):
            async with httpx2.AsyncClient(
                timeout=4, follow_redirects=False, trust_env=False,
                headers={"Accept-Encoding": "identity"}, event_hooks={"response": [check_response]},
                transport=_make_mcp_body_cap_transport(httpx2, transport or httpx2.AsyncHTTPTransport(), 1024 * 1024),
            ) as client:
                async with streamable_http_client(url, http_client=client, max_sse_event_size=1024 * 1024) as streams:
                    async with ClientSession(*streams[:2]) as session:
                        await session.initialize()
                        listing = await session.list_tools()
                        return len(listing.tools)

    try:
        count = anyio.run(check)
    except Exception:
        # Do not reflect the remote response, URL, or diagnostics to the console.
        raise MCPCheckError("The MCP health check failed. Check the Streamable HTTP endpoint and try again.") from None
    if not count:
        raise MCPCheckError("The MCP server didn’t expose any tools. Nothing was saved.")
    return count
