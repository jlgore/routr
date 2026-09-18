/*
 * Copyright (C) 2026 by Fonoster Inc (https://fonoster.com)
 * http://github.com/fonoster/routr
 *
 * This file is part of Routr.
 *
 * Licensed under the MIT License (the "License");
 * you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 *
 *    https://opensource.org/licenses/MIT
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import chai from "chai"
import sinon from "sinon"
import sinonChai from "sinon-chai"
import {
  Auth,
  CommonConnect as CC,
  CommonTypes as CT,
  MessageRequest
} from "@routr/common"
import { ILocationService } from "@routr/location"
import { Response, Target } from "@routr/processor"
import { router } from "../src/router"
import { handleRequest } from "../src/handlers/request"
import { RoutingDirection } from "../src/types"
import { findResource } from "../src/utils"
import { createRequest, r1, r2 } from "./examples"
import { apiClient } from "./mock_apis"

const expect = chai.expect
chai.use(sinonChai)
const sandbox = sinon.createSandbox()

const peerRequest = () =>
  createRequest({
    fromUser: "asterisk",
    fromDomain: "unknown.com",
    toUser: "1002",
    toDomain: "sip.local"
  })

const agentRequest = () =>
  createRequest({
    fromUser: "1001",
    fromDomain: "sip.local",
    toUser: "asterisk",
    toDomain: "sip.local"
  })

const authenticate = async (req: MessageRequest) => {
  const from = req.message.from.address.uri
  const caller = (await findResource(apiClient, from.host, from.user)) as
    | CC.Peer
    | CC.Agent
  const auth = req.message.authorization
  auth.username = caller.credentials.username
  auth.uri = Target.getAOR(req.message.requestUri)
  auth.response = Auth.calculateAuthResponse(
    { ...auth, method: req.method } as CT.AuthChallengeResponse,
    {
      username: caller.credentials.username,
      secret: caller.credentials.password
    }
  )
}

describe("@routr/connect peer routing", () => {
  afterEach(() => sandbox.restore())
  ;[
    {
      direction: RoutingDirection.PEER_TO_AGENT,
      create: peerRequest,
      destination: r1
    },
    {
      direction: RoutingDirection.AGENT_TO_PEER,
      create: agentRequest,
      destination: r2
    }
  ].forEach(({ direction, create, destination }) => {
    it(`routes an authenticated ${direction} INVITE`, async () => {
      const req = create()
      await authenticate(req)
      const findRoutes = sandbox.stub().resolves([{ ...destination }])
      const location = { findRoutes } as unknown as ILocationService

      const result = await router(location, apiClient)(req)

      expect(result.direction).to.equal(direction)
      expect(result.route).to.include({
        user: destination.user,
        host: destination.host
      })
      expect(findRoutes).to.have.been.calledOnce
    })
    ;["missing", "invalid"].forEach((authorization) => {
      it(`challenges ${direction} with ${authorization} credentials before looking up a route`, async () => {
        const req = create()
        await authenticate(req)
        if (authorization === "missing") {
          req.message.authorization = undefined
        } else {
          req.message.authorization.response = "invalid"
        }
        const findRoutes = sandbox.stub().resolves([{ ...destination }])
        const location = { findRoutes } as unknown as ILocationService

        const result = await router(location, apiClient)(req)

        expect(result).not.to.have.property("direction")
        expect(result)
          .to.have.property("message")
          .to.have.property("responseType", CT.ResponseType.UNAUTHORIZED)
        expect(findRoutes).not.to.have.been.called
      })
    })
  })
  ;[false, true].forEach((secure) => {
    it(`routes peer-to-agent using the ${
      secure ? "sips" : "sip"
    } Request-URI when To differs`, async () => {
      const req = peerRequest()
      req.message.to.address.uri.user = "1001"
      req.message.to.address.uri.host = "other.example"
      req.message.requestUri.secure = secure
      await authenticate(req)
      const findRoutes = sandbox.stub().resolves([])
      findRoutes
        .withArgs({
          aor: `${secure ? "sips" : "sip"}:1002@sip.local`,
          callId: req.ref
        })
        .resolves([{ ...r1 }])
      const location = { findRoutes } as unknown as ILocationService

      const result = await router(location, apiClient)(req)

      expect(result.direction).to.equal(RoutingDirection.PEER_TO_AGENT)
      expect(result.route).to.include({ user: r1.user, host: r1.host })
    })
  })

  it("returns temporarily unavailable for an unregistered destination agent", async () => {
    const req = peerRequest()
    await authenticate(req)
    const location = {
      findRoutes: sandbox.stub().resolves([])
    } as unknown as ILocationService
    const callback = sandbox.spy()

    await handleRequest(location, apiClient)(req, new Response(callback))

    expect(callback).to.have.been.calledOnce
    expect(callback.firstCall.args[1])
      .to.have.property("message")
      .to.have.property("responseType", CT.ResponseType.TEMPORARILY_UNAVAILABLE)
  })

  it("forwards peer-to-agent with its direction header and destination metadata", async () => {
    const req = peerRequest()
    await authenticate(req)
    const agent = (await findResource(
      apiClient,
      "sip.local",
      "1002"
    )) as CC.Agent
    const findAgent = sandbox.stub(apiClient.agents, "findBy").callThrough()
    findAgent
      .withArgs({ fieldName: "username", fieldValue: "1002" })
      .resolves({ items: [{ ...agent, extended: { account: "destination" } }] })
    const location = {
      findRoutes: sandbox.stub().resolves([
        {
          ...r1,
          listeningPoints: req.listeningPoints,
          localnets: req.localnets,
          externalAddrs: req.externalAddrs
        }
      ])
    } as unknown as ILocationService
    const callback = sandbox.spy()

    await handleRequest(location, apiClient)(req, new Response(callback))

    expect(callback).to.have.been.calledOnce
    const forwarded = callback.firstCall.args[1]
    expect(forwarded.metadata).to.deep.equal({ account: "destination" })
    expect(forwarded.message.extensions).to.deep.include({
      name: CT.ExtraHeader.CALL_DIRECTION,
      value: RoutingDirection.PEER_TO_AGENT
    })
    expect(forwarded.message).not.to.have.property("authorization")
  })
})
