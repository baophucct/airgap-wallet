import { Location } from '@angular/common'
import { Component } from '@angular/core'
import { ActivatedRoute, Router } from '@angular/router'
import { ToastController, PopoverController } from '@ionic/angular'
import { AirGapMarketWallet, BakerInfo, DelegationRewardInfo, TezosKtProtocol, DelegationInfo } from 'airgap-coin-lib'
import BigNumber from 'bignumber.js'
import * as moment from 'moment'

import { DataService, DataServiceKey } from '../../services/data/data.service'
import { OperationsProvider } from '../../services/operations/operations'
import { ProtocolSymbols } from '../../services/protocols/protocols'
import { BakerConfig, RemoteConfigProvider } from '../../services/remote-config/remote-config'
import { ErrorCategory, handleErrorSentry } from '../../services/sentry-error-handler/sentry-error-handler'
import { DelegateEditPopoverComponent } from '../../components/delegate-edit-popover/delegate-edit-popover.component'
import { OverlayEventDetail } from '@ionic/core'

type Moment = moment.Moment

const hoursPerCycle = 68

@Component({
  selector: 'page-delegation-baker-detail',
  templateUrl: 'delegation-baker-detail.html',
  styleUrls: ['./delegation-baker-detail.scss']
})
export class DelegationBakerDetailPage {
  public bakerConfig: BakerConfig
  public bakerConfigError: string | undefined

  public wallet: AirGapMarketWallet

  public bakerInfo: BakerInfo
  public delegationRewards: DelegationRewardInfo[]

  public avgRoIPerCyclePercentage: BigNumber
  public avgRoIPerCycle: BigNumber

  public isDelegated: boolean
  public nextPayout: Date

  public delegationInfo: DelegationInfo

  private airGapBaker: BakerConfig

  constructor(
    public location: Location,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    public toastController: ToastController,
    public operationsProvider: OperationsProvider,
    public remoteConfigProvider: RemoteConfigProvider,
    private readonly dataService: DataService,
    public popoverCtrl: PopoverController
  ) {
    if (this.route.snapshot.data.special) {
      const info = this.route.snapshot.data.special
      this.wallet = info.wallet
    }
  }

  public async ionViewDidEnter() {
    // get baker 0, always airgap for now
    const airGapBakerConfig = (await this.remoteConfigProvider.tezosBakers())[0]
    this.airGapBaker = airGapBakerConfig

    this.delegationInfo = await this.operationsProvider.checkDelegated(this.wallet.receivingPublicAddress)
    this.isDelegated = this.delegationInfo.isDelegated

    // If baker is not us, we can't display more info
    const config =
      !this.delegationInfo.value || this.delegationInfo.value === airGapBakerConfig.address
        ? airGapBakerConfig
        : { address: this.delegationInfo.value }

    this.setBaker(config)
  }

  public async calculateBakerStats(): Promise<void> {
    const kt = new TezosKtProtocol()

    this.bakerInfo = await kt.bakerInfo(this.bakerConfig.address)

    // TODO: Remove once the baker capacity is calculated correctly in the coinlib
    this.bakerInfo.bakerCapacity = this.bakerInfo.bakerCapacity.multipliedBy(0.7)
    this.bakerInfo.bakerUsage = this.bakerInfo.stakingBalance.div(this.bakerInfo.bakerCapacity)
    // End remove

    try {
      this.delegationRewards = await kt.delegationRewards(this.bakerConfig.address)

      // we are already delegating, and to this address
      if (this.delegationInfo.isDelegated && this.delegationInfo.value === this.bakerConfig.address) {
        const delegatedCycles = this.delegationRewards.filter(value => value.delegatedBalance.isGreaterThan(0))

        this.nextPayout = delegatedCycles.length > 0 ? delegatedCycles[0].payout : this.addPayoutDelayToMoment(moment()).toDate()

        // make sure there are at least 7 cycles to wait
        if (this.addPayoutDelayToMoment(moment(this.delegationInfo.delegatedDate)).isAfter(this.nextPayout)) {
          this.nextPayout = this.addPayoutDelayToMoment(moment(this.delegationInfo.delegatedDate)).toDate()
        }
      } else {
        // if we are currently delegated, but to someone else, first payout is in 7 cycles, same for if we are undelegated
        this.nextPayout = this.addPayoutDelayToMoment(moment()).toDate()
      }

      this.avgRoIPerCyclePercentage = this.delegationRewards
        .map(delegationInfo => {
          return delegationInfo.totalRewards.plus(delegationInfo.totalFees).div(delegationInfo.stakingBalance)
        })
        .reduce((avg, value) => {
          return avg.plus(value)
        })
        .div(this.delegationRewards.length)

      this.avgRoIPerCycle = this.avgRoIPerCyclePercentage.multipliedBy(this.wallet.currentBalance)
    } catch (error) {
      // If Baker has never delegated
    }
  }

  public setBaker(config: Partial<BakerConfig>): void {
    this.bakerConfig = {
      name: 'unknown',
      address: '',
      fee: undefined,
      enabled: true,
      payout: {
        cycles: 0,
        time: undefined
      },
      ...config
    }

    const ktProtocol = new TezosKtProtocol()
    const re = new RegExp(ktProtocol.addressValidationPattern)
    if (re.exec(this.bakerConfig.address)) {
      // Valid address
      this.bakerConfigError = undefined
      this.calculateBakerStats()
    } else {
      // Invalid address
      this.bakerConfigError = 'delegation-baker-detail.invalid-address'
      this.delegationRewards = []
      this.bakerInfo = undefined
      this.nextPayout = undefined
      this.avgRoIPerCyclePercentage = new BigNumber(0)
      this.avgRoIPerCycle = new BigNumber(0)
    }
  }

  public addPayoutDelayToMoment(time: Moment): Moment {
    return time.add(hoursPerCycle * 7 + this.bakerConfig.payout.cycles, 'h')
  }

  public async delegate() {
    try {
      if (this.wallet.protocolIdentifier === ProtocolSymbols.XTZ) {
        const pageOptions = await this.operationsProvider.prepareOriginate(this.wallet, this.bakerConfig.address)
        this.dataService.setData(DataServiceKey.INTERACTION, pageOptions.params)
        this.router.navigateByUrl('/interaction-selection/' + DataServiceKey.INTERACTION).catch(handleErrorSentry(ErrorCategory.NAVIGATION))
      } else {
        const pageOptions = await this.operationsProvider.prepareDelegate(this.wallet, this.bakerConfig.address)
        this.dataService.setData(DataServiceKey.INTERACTION, pageOptions.params)
        this.router.navigateByUrl('/interaction-selection/' + DataServiceKey.INTERACTION).catch(handleErrorSentry(ErrorCategory.NAVIGATION))
      }
    } catch (error) {
      handleErrorSentry(ErrorCategory.OPERATIONS_PROVIDER)(error)

      this.toastController
        .create({
          message: error.message,
          duration: 3000,
          position: 'bottom'
        })
        .then(toast => {
          toast.present().catch(handleErrorSentry(ErrorCategory.IONIC_TOAST))
        })
    }
  }

  public async done() {
    this.location.back()
  }

  public async presentEditPopover(event) {
    const popover: HTMLIonPopoverElement = await this.popoverCtrl.create({
      component: DelegateEditPopoverComponent,
      componentProps: {
        hideAirGap: this.bakerConfig.address === this.airGapBaker.address
      },
      event,
      translucent: true
    })

    function isBakerAddressObject(value: unknown): value is { bakerAddress: string } {
      return value instanceof Object && 'bakerAddress' in value
    }

    function isChangeToAirGapObject(value: unknown): value is { changeToAirGap: boolean } {
      return value instanceof Object && 'changeToAirGap' in value
    }

    popover
      .onDidDismiss()
      .then(({ data }: OverlayEventDetail<unknown>) => {
        if (isBakerAddressObject(data)) {
          console.log(data.bakerAddress)
          this.setBaker({ address: data.bakerAddress })
        } else if (isChangeToAirGapObject(data) && data.changeToAirGap) {
          this.setBaker(this.airGapBaker)
        } else {
          console.log('Did not receive valid baker address object')
        }
        console.log('dismiss')
      })
      .catch(handleErrorSentry(ErrorCategory.IONIC_ALERT))

    return popover.present().catch(handleErrorSentry(ErrorCategory.NAVIGATION))
  }
}
