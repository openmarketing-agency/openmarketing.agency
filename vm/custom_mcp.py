"""Check MCP endpoints: an operator-approved custom server, and the default agent's Composio connections."""

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


COMPOSIO_SEARCH = "COMPOSIO_SEARCH_TOOLS"


def _search_payload(result):
    """Parse a COMPOSIO_SEARCH_TOOLS result the way oma-agent's analytics collector does."""
    import json

    # Newer MCP clients use snake_case result fields; older ones use camelCase.
    value = getattr(result, "structured_content", getattr(result, "structuredContent", None))
    if value is None:
        value = "".join(getattr(item, "text", "") for item in result.content)
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict) or value.get("error") or value.get("successful") is False:
        raise ValueError("Composio search failed.")
    data = value.get("data", value)
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        raise ValueError("Composio search returned an unexpected result.")
    return data


def toolkit_connections(url, headers, toolkits, *, transport=None):
    """Return {toolkit: True/False} for toolkits whose status Composio reported. Calls only the read-only search tool."""
    import anyio
    import httpx2
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from tools.mcp_tool_errors import _make_mcp_body_cap_transport

    wanted = sorted(set(toolkits))
    if not wanted:
        return {}

    async def search():
        async def check_response(response):
            if response.has_redirect_location or response.headers.get("content-encoding", "identity").lower() != "identity":
                raise httpx2.RequestError("Redirects and compressed responses are not supported.")

        with anyio.fail_after(20):
            async with httpx2.AsyncClient(
                timeout=15, follow_redirects=False, trust_env=False,
                headers={**headers, "Accept-Encoding": "identity"}, event_hooks={"response": [check_response]},
                transport=_make_mcp_body_cap_transport(httpx2, transport or httpx2.AsyncHTTPTransport(), 4 * 1024 * 1024),
            ) as client:
                async with streamable_http_client(url, http_client=client, max_sse_event_size=4 * 1024 * 1024) as streams:
                    async with ClientSession(*streams[:2]) as session:
                        await session.initialize()
                        return await session.call_tool(COMPOSIO_SEARCH, {
                            "queries": [{"use_case": f"Use the {toolkit} toolkit with the connected account."}
                                        for toolkit in wanted],
                            "session": {"generate_id": True},
                        })

    try:
        result = anyio.run(search)
        if getattr(result, "is_error", getattr(result, "isError", False)):
            raise ValueError("Composio search failed.")
        rows = _search_payload(result).get("toolkit_connection_statuses", ())
    except Exception:
        # Do not reflect the remote response, URL, or credentials to the console.
        raise MCPCheckError("Couldn’t check Composio connections. Check the Composio MCP URL and API key in Settings.") from None
    statuses = {}
    for row in rows if isinstance(rows, list) else ():
        toolkit = row.get("toolkit") if isinstance(row, dict) else None
        if isinstance(toolkit, str) and toolkit.lower() in wanted:
            statuses[toolkit.lower()] = row.get("has_active_connection") is True
    return statuses
