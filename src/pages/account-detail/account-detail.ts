import { Component } from '@angular/core'
import { NavController, NavParams, PopoverController } from 'ionic-angular'
import { AirGapMarketWallet, TezosKtProtocol, EncodedType, SyncProtocolUtils } from 'airgap-coin-lib'
import { SubAccountProvider } from '../../providers/account/sub-account.provider'
import { handleErrorSentry, ErrorCategory } from '../../providers/sentry-error-handler/sentry-error-handler'
import { AccountTransactionListPage } from '../account-transaction-list/account-transaction-list'
import { AddSubAccountPage } from '../add-sub-account/add-sub-account'
import { AccountEditPopoverComponent } from '../../components/account-edit-popover/account-edit-popover.component'
import { TransactionPreparePage } from '../transaction-prepare/transaction-prepare'
import { InteractionSelectionPage } from '../interaction-selection/interaction-selection'

@Component({
  selector: 'page-account-detail',
  templateUrl: 'account-detail.html'
})
export class AccountDetailPage {
  wallet: AirGapMarketWallet
  protocolIdentifier: string
  subWallets: AirGapMarketWallet[]

  constructor(
    public navCtrl: NavController,
    public navParams: NavParams,
    private popoverCtrl: PopoverController,
    private subAccountProvider: SubAccountProvider
  ) {
    this.wallet = this.navParams.get('wallet')
    this.protocolIdentifier = this.wallet.coinProtocol.identifier
    this.subAccountProvider.wallets.subscribe(subWallets => {
      this.subWallets = subWallets.filter(subWallet => subWallet.publicKey === this.wallet.publicKey)
    })
  }

  openTransactionPage(wallet: AirGapMarketWallet) {
    console.log('wallet', wallet)
    this.navCtrl.push(AccountTransactionListPage, { wallet: wallet }).catch(handleErrorSentry(ErrorCategory.NAVIGATION))
  }

  openAddAccountPage(wallet: AirGapMarketWallet) {
    this.navCtrl.push(AddSubAccountPage, { wallet: wallet }).catch(handleErrorSentry(ErrorCategory.NAVIGATION))
  }

  openPreparePage() {
    this.navCtrl
      .push(TransactionPreparePage, {
        wallet: this.wallet
      })
      .catch(handleErrorSentry(ErrorCategory.NAVIGATION))
  }

  presentEditPopover(event) {
    let popover = this.popoverCtrl.create(AccountEditPopoverComponent, {
      wallet: this.wallet,
      onDelete: () => {
        this.navCtrl.pop().catch(handleErrorSentry(ErrorCategory.NAVIGATION))
      }
    })
    popover
      .present({
        ev: event
      })
      .catch(handleErrorSentry(ErrorCategory.NAVIGATION))
  }

  async prepareOriginate() {
    console.log(this.wallet)
    const protocol = new TezosKtProtocol()
    const originateTx = await protocol.originate(this.wallet.publicKey)

    const syncProtocol = new SyncProtocolUtils()
    const serializedTx = await syncProtocol.serialize({
      version: 1,
      protocol: this.wallet.coinProtocol.identifier,
      type: EncodedType.UNSIGNED_TRANSACTION,
      payload: {
        publicKey: this.wallet.publicKey,
        transaction: originateTx,
        callback: 'airgap-wallet://?d='
      }
    })

    this.navCtrl
      .push(InteractionSelectionPage, {
        wallet: this.wallet,
        airGapTx: originateTx,
        data: 'airgap-vault://?d=' + serializedTx
      })
      .catch(handleErrorSentry(ErrorCategory.NAVIGATION))

    console.log('originate', originateTx)
  }
}
